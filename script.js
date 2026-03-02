import { openaiConfig } from "bootstrap-llm-provider";
import { bootstrapAlert } from "bootstrap-alert";
import { calculateMSI, calculateMMI, MEDICAL_ANALYSIS_PROMPT, getPrintStyles } from "./util.js";

let players = [];
let currentPlayerView = null;
let selectedComparePlayers = new Set();
let provider = null;
let currentModel = "anthropic/claude-sonnet-4.5";

// ========== UTILITY FUNCTIONS ==========
function formatDate(dateStr) {
    if (!dateStr || dateStr === 'N/A') return 'N/A';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = date.getDate();
        return `${months[date.getMonth()]} ${day}, ${date.getFullYear()}`;
    } catch (e) {
        return dateStr;
    }
}

function getScoreLabel(score) {
    // Handle invalid scores
    if (isNaN(score) || score === null || score === undefined) {
        return { label: "Unknown", class: "score-medium", badge: "secondary" };
    }
    const validScore = Math.max(0, Math.min(100, score));
    if (validScore >= 75) return { label: "Low Risk", class: "score-low", badge: "success" };
    if (validScore >= 51) return { label: "Moderate Risk", class: "score-medium", badge: "warning" };
    return { label: "High Risk", class: "score-high", badge: "danger" };
}

function getScoreExplanation(breakdown) {
    if (!breakdown) return [];
    
    const deductions = [];
    if (breakdown.orthoPenalty > 0) deductions.push({ reason: "Orthopedic injuries & surgeries", value: breakdown.orthoPenalty });
    if (breakdown.redFlagPenalty > 0) deductions.push({ reason: "Structural red flags", value: breakdown.redFlagPenalty });
    if (breakdown.availabilityPenalty > 0) deductions.push({ reason: "Missed games & availability", value: breakdown.availabilityPenalty });
    if (breakdown.neuroPenalty > 0) deductions.push({ reason: "Neurological concerns", value: breakdown.neuroPenalty });
    deductions.sort((a, b) => b.value - a.value);
    return deductions.slice(0, 4);
}

// Recalculate all scores
function recalculateScores() {
    players.forEach(p => {
        try {
            if (!p.facts) {
                console.warn(`Player ${p.name} has no facts object, initializing...`);
                p.facts = {
                    injuries: [],
                    surgeries: [],
                    imagingFindings: [],
                    flags: {},
                    summaryCounts: {},
                    availability: {},
                    neuro: { concussions: [], cervicalEvents: [] },
                    scoringInputs: {},
                    timeline: []
                };
            }
            const result = calculateMSI(p.facts);
            p.score = isNaN(result.msi) ? 100 : result.msi;
            p.scoreBreakdown = result.breakdown;
            const mmiResult = calculateMMI(p.facts);
            p.mmi = mmiResult.mmi;
            p.mmiBreakdown = mmiResult;
            console.log(`Score calculated for ${p.name}: MSI=${p.score} MMI=${p.mmi}`, result.breakdown);
        } catch (error) {
            console.error(`Error calculating score for ${p.name}:`, error);
            p.score = 100;
            p.scoreBreakdown = {
                orthoPenalty: 0,
                redFlagPenalty: 0,
                availabilityPenalty: 0,
                neuroPenalty: 0,
                totalBasePenalty: 0,
                recentBoostMultiplier: 1.0,
                totalPenalty: 0
            };
        }
    });
}
recalculateScores();

// ========== PDF PROCESSING ==========
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

async function extractTextFromPDF(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        } 
        return fullText;
    } catch (error) {
        console.error('Error extracting PDF text:', error);
        throw error;
    }
}

async function extractTextFromTXT(file) {  return await file.text(); }

async function initLLM(show = false) {
    try {
        const cfg = await openaiConfig({
            title: "LLM Configuration for Medical Document Analysis",
            defaultBaseUrls: ["https://llmfoundry.straive.com/openrouter/v1", "https://api.openai.com/v1", "https://openrouter.ai/api/v1"],
            show,
        });
        provider = { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey };
    } catch (e) {
        bootstrapAlert({ body: `Failed to configure LLM: ${e.message}`, color: "danger" });
        throw e;
    }
}

async function analyzeMedicalDocuments(documentsData, providedPlayerName = '') {
    if (!provider) {
        await initLLM();
        if (!provider) {   throw new Error('LLM not configured');  }
    }

    // Get system prompt from textarea
    const systemPrompt = document.getElementById('system-prompt').value.trim();
    // Combine all document texts
    const combinedDocuments = documentsData.map(doc => 
        `--- Document: ${doc.filename} ---\n${doc.text}\n`
    ).join('\n\n');

    const playerNameHint = providedPlayerName ? `Player Name (provided): ${providedPlayerName}` : 'Player Name: Extract from documents';

    const prompt = `${playerNameHint}

Medical Documents:
${combinedDocuments}

${MEDICAL_ANALYSIS_PROMPT}`;

    try {
        const response = await fetch(`${provider.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json',  'Authorization': `Bearer ${provider.apiKey}` },
            body: JSON.stringify({
                model: currentModel,
                messages: [ {  role: 'system',  content: systemPrompt }, { role: 'user',  content: prompt } ]
            })
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'API request failed');
        }
        const data = await response.json();
        let content = data.choices[0].message.content.trim();
        // Remove markdown code blocks if present
        content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const analysis = JSON.parse(content);
        return analysis;
    } catch (error) {
        console.error('LLM Analysis Error:', error);
        throw error;
    }
}

function inferDocType(filename) {
    const lower = filename.toLowerCase();
    if (lower.includes('ortho')) return 'Ortho';
    if (lower.includes('genmed') || lower.includes('general')) return 'GenMed';
    if (lower.includes('mri')) return 'MRI';
    if (lower.includes('xr') || lower.includes('xray')) return 'XR';
    if (lower.includes('history')) return 'History';
    if (lower.includes('college')) return 'College';
    if (lower.includes('concussion')) return 'Concussion';
    if (lower.includes('knee')) return 'Knee';
    if (lower.includes('shoulder')) return 'Shoulder';
    return 'Medical';
}

// ========== UPLOAD & PROCESS ==========
document.getElementById('uploadFilesBtn').addEventListener('click', async () => {
    const files = document.getElementById('fileInput').files;
    if (files.length === 0) {  alert('Please select files to upload.');  return; }
    const progressContainer = document.getElementById('uploadProgress');
    const progressBar = progressContainer.querySelector('.progress-bar');
    const progressText = document.getElementById('progressText');
    progressContainer.classList.remove('d-none');
    document.getElementById('uploadFilesBtn').disabled = true;
    try {
        // Step 1: Extract text from all uploaded documents
        progressText.textContent = `Extracting text from ${files.length} document(s)...`;
        progressBar.style.width = '30%';
        const documentsData = [];
        for (const file of Array.from(files)) {
            let text;
            if (file.name.toLowerCase().endsWith('.pdf')) { text = await extractTextFromPDF(file); }
            else { text = await extractTextFromTXT(file); }
            documentsData.push({  filename: file.name,  docType: inferDocType(file.name),  text: text });
        }
        // Step 2: Send all documents to LLM in a single request
        progressText.textContent = `Analyzing ${files.length} document(s) with AI...`;
        progressBar.style.width = '60%';
        const analysis = await analyzeMedicalDocuments(documentsData, '');
        // Step 3: Create or update player
        progressText.textContent = 'Creating player profile...';
        progressBar.style.width = '90%';
        const playerName = analysis.player?.name || 'Unknown Player';
        let player = players.find(p => p.name === playerName);
        if (!player) {
            // Create new player
            player = {
                id: players.length + 1,
                name: playerName,
                draftYear: analysis.player?.draftYear || 2022,
                handedness: analysis.player?.handedness || 'Unknown',
                documents: [],
                facts: analysis,
                score: 0,
                scoreBreakdown: null
            };
            players.push(player);
        } else {
            // Replace existing player data with new comprehensive analysis
            player.draftYear = analysis.player?.draftYear || player.draftYear;
            player.handedness = analysis.player?.handedness || player.handedness;
            player.facts = analysis;
        }
        // Validate and fix counts to match actual array lengths
        if (!player.facts.summaryCounts) player.facts.summaryCounts = {};
        player.facts.summaryCounts.surgeriesTotal = (player.facts.surgeries || []).length;
        player.facts.summaryCounts.concussionsTotal = (player.facts.neuro?.concussions || []).length;
        player.facts.summaryCounts.cervicalNeurologicEventsTotal = (player.facts.neuro?.cervicalEvents || []).length;
        const injuries = player.facts.injuries || [];
        player.facts.summaryCounts.majorInjuriesTotal = injuries.filter(i => i.severity === 'Major').length;
        player.facts.summaryCounts.moderateInjuriesTotal = injuries.filter(i => i.severity === 'Moderate').length;
        player.facts.summaryCounts.minorInjuriesTotal = injuries.filter(i => i.severity === 'Minor').length;
        // Calculate major/non-major joint surgeries
        const surgeries = player.facts.surgeries || [];
        player.facts.summaryCounts.surgeriesMajorJoint = surgeries.filter(s => s.majorJoint).length;
        player.facts.summaryCounts.surgeriesNonMajorJoint = surgeries.filter(s => !s.majorJoint).length;
        // Validate flags based on actual imaging findings
        if (!player.facts.flags) player.facts.flags = {};
        const imgs = player.facts.imagingFindings || [];
        player.facts.flags.cartilageDegeneration = imgs.some(img => 
            img.structuredFindings?.cartilageDamage && 
            !['None', 'Unknown'].includes(img.structuredFindings.cartilageDamage)
        );
        player.facts.flags.looseBodies = imgs.some(img => img.structuredFindings?.looseBodies === true);
        player.facts.flags.osteoarthritisOrArthrosis = imgs.some(img => 
            img.structuredFindings?.degenerativeChange && 
            ['Moderate', 'Severe'].includes(img.structuredFindings.degenerativeChange)
        ) || imgs.some(img => img.structuredFindings?.postTraumaticArthritis === true);
        // Add all documents to player
        for (const docData of documentsData) {
            player.documents.push({filename: docData.filename,docType: docData.docType,
                uploadedAt: new Date().toISOString().split('T')[0]
            });
        }

        recalculateScores();
        renderPlayerSelector();
        renderCompareCheckboxes();
        document.getElementById('fileInput').value = '';
        progressText.textContent = 'Analysis complete!';
        progressBar.style.width = '100%';
        setTimeout(() => {
            progressContainer.classList.add('d-none');
            progressBar.style.width = '0%';
        }, 2000);
        showToast(`document(s) analyzed successfully for ${playerName}!`);
    } catch (error) {
        console.error('Upload error:', error);
        showToast(`Error: ${error.message}`, 'danger');
    } finally { document.getElementById('uploadFilesBtn').disabled = false;  }
});

// ========== TAB B: PLAYER VIEW ==========
function renderPlayerSelector() {
    const selector = document.getElementById('playerSelector');
    selector.innerHTML = '<option value="">-- Select a Player --</option>';
    players.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    selector.appendChild(opt);
    });
}

document.getElementById('playerSelector').addEventListener('change', (e) => {
    const playerId = parseInt(e.target.value);
    if (!playerId) { document.getElementById('playerDashboard').innerHTML = ''; return;  }
    currentPlayerView = playerId;
    renderPlayerDashboard(playerId);
});

function renderPlayerDashboard(playerId) {
    const player = players.find(p => p.id === playerId);
    if (!player) { console.error('Player not found:', playerId);  return; }
    // Ensure player has valid facts and score
    if (!player.facts) {
        player.facts = {
            injuries: [],
            surgeries: [],
            imagingFindings: [],
            flags: {},
            summaryCounts: {},
            availability: {},
            neuro: { concussions: [], cervicalEvents: [] },
            scoringInputs: {},
            timeline: []
        };
    }
    // Recalculate score if missing or invalid
    if (player.score === undefined || player.score === null || isNaN(player.score)) {
        const result = calculateMSI(player.facts);
        player.score = result.msi;
        player.scoreBreakdown = result.breakdown;
    }
    console.log('Rendering dashboard for:', player.name, 'Score:', player.score, 'Breakdown:', player.scoreBreakdown);
    const scoreInfo = getScoreLabel(player.score);
    const explanation = getScoreExplanation(player.scoreBreakdown);
    // Initialize sort state if not exists
    if (!player.sortState) {
        player.sortState = {
            injuries: { column: 'date', direction: 'desc' },
            surgeries: { column: 'date', direction: 'desc' },
            imaging: { column: 'date', direction: 'desc' }
        };
    }

    // Sort injuries
    const sortedInjuries = [...(player.facts.injuries || [])].sort((a, b) => {
        const state = player.sortState.injuries;
        let aVal, bVal;
        switch(state.column) {
            case 'date':
                aVal = new Date(a.date || '1900-01-01');
                bVal = new Date(b.date || '1900-01-01');
                break;
            case 'injury':
                aVal = (a.injuryName || 'Unknown').toLowerCase();
                bVal = (b.injuryName || 'Unknown').toLowerCase();
                break;
            case 'bodyRegion':
                aVal = (a.bodyRegion || 'Unknown').toLowerCase();
                bVal = (b.bodyRegion || 'Unknown').toLowerCase();
                break;
            case 'severity':
                const sevOrder = { 'Major': 3, 'Moderate': 2, 'Minor': 1, 'Unknown': 0 };
                aVal = sevOrder[a.severity] || 0;
                bVal = sevOrder[b.severity] || 0;
                break;
            case 'status':
                aVal = (a.currentStatus || 'Unknown').toLowerCase();
                bVal = (b.currentStatus || 'Unknown').toLowerCase();
                break;
            default:
                return 0;
        }
        if (aVal < bVal) return state.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return state.direction === 'asc' ? 1 : -1;
        return 0;
    });

    // Sort surgeries
    const sortedSurgeries = [...(player.facts.surgeries || [])].sort((a, b) => {
        const state = player.sortState.surgeries;
        let aVal, bVal;
        
        switch(state.column) {
            case 'date':
                aVal = new Date(a.date || '1900-01-01');
                bVal = new Date(b.date || '1900-01-01');
                break;
            case 'procedure':
                aVal = (a.procedure || 'Unknown').toLowerCase();
                bVal = (b.procedure || 'Unknown').toLowerCase();
                break;
            case 'bodyRegion':
                aVal = (a.bodyRegion || 'Unknown').toLowerCase();
                bVal = (b.bodyRegion || 'Unknown').toLowerCase();
                break;
            case 'type':
                aVal = (a.procedureCategory || 'Unknown').toLowerCase();
                bVal = (b.procedureCategory || 'Unknown').toLowerCase();
                break;
            case 'outcome':
                aVal = (a.outcome?.residualSymptoms || 'Unknown').toLowerCase();
                bVal = (b.outcome?.residualSymptoms || 'Unknown').toLowerCase();
                break;
            default:
                return 0;
        }
        
        if (aVal < bVal) return state.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return state.direction === 'asc' ? 1 : -1;
        return 0;
    });

    // Sort imaging findings
    const sortedImaging = [...(player.facts.imagingFindings || [])].sort((a, b) => {
        const state = player.sortState.imaging;
        let aVal, bVal;
        
        switch(state.column) {
            case 'date':
                aVal = new Date(a.date || '1900-01-01');
                bVal = new Date(b.date || '1900-01-01');
                break;
            case 'modality':
                aVal = (a.modality || 'Unknown').toLowerCase();
                bVal = (b.modality || 'Unknown').toLowerCase();
                break;
            case 'bodyRegion':
                aVal = (a.bodyRegion || 'Unknown').toLowerCase();
                bVal = (b.bodyRegion || 'Unknown').toLowerCase();
                break;
            default:
                return 0;
        }
        
        if (aVal < bVal) return state.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return state.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const dashboard = document.getElementById('playerDashboard');
    dashboard.innerHTML = `
    <div class="card mb-3">
        <div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h4>${player.name}</h4>
            <button class="btn btn-sm btn-outline-secondary d-none" onclick="openEditFactsModal(${player.id})">
                <i class="bi bi-pencil me-1"></i> Edit Facts
            </button>
        </div>
        <div class="row g-3">
            <!-- MSI Panel (left) -->
            <div class="col-md-6">
            <div class="h-100 p-3 rounded border">
                <div class="text-center mb-3">
                    <div class="score-circle ${scoreInfo.class}" style="width:120px;height:120px;font-size:2.4rem;margin:0 auto;">${player.score}</div>
                    <div class="mt-2 fw-bold fs-5">MSI <small class="text-muted fw-normal" style="font-size:0.8rem;">Medical Score Index</small></div>
                    <div class="text-muted small mb-1" style="font-size:0.75rem;">
                        <span class="me-2"><span class="badge bg-danger">0–49</span> High Risk</span>
                        <span class="me-2"><span class="badge bg-warning text-dark">50–74</span> Moderate Risk</span>
                        <span><span class="badge bg-success">≥75</span> Low Risk</span>
                    </div>
                    <h6 class="mt-1"><span class="badge bg-${scoreInfo.badge}">${scoreInfo.label}</span></h6>
                    <div class="progress mt-2" style="height: 18px;">
                        <div class="progress-bar bg-${scoreInfo.badge}" role="progressbar" style="width: ${player.score}%">${player.score}%</div>
                    </div>
                </div>
                <h6 class="border-top pt-2">Score Calculation</h6>
                <div style="font-size:0.88rem;">
                    <div class="d-flex justify-content-between align-items-center py-1 border-bottom">
                        <span><i class="bi bi-flag-fill text-success me-1"></i><strong>Base Score</strong></span>
                        <span class="fw-bold text-success">100</span>
                    </div>
                    ${explanation.length > 0 ? explanation.map(e => `
                    <div class="d-flex justify-content-between align-items-center py-1 border-bottom text-danger">
                        <span><i class="bi bi-dash-circle me-1"></i>${e.reason}</span>
                        <span class="fw-bold">−${e.value.toFixed(1)}</span>
                    </div>`).join('') : '<div class="py-1 text-muted">No deductions</div>'}
                    ${player.scoreBreakdown ? `
                    <div class="d-flex justify-content-between align-items-center py-1 border-bottom text-secondary">
                        <span><i class="bi bi-sigma me-1"></i><strong>Total Base Penalty</strong></span>
                        <span class="fw-bold">−${player.scoreBreakdown.totalBasePenalty.toFixed(1)}</span>
                    </div>
                    <div class="d-flex justify-content-between align-items-center py-1 border-bottom" style="color:#6f42c1;">
                        <span><i class="bi bi-lightning-fill me-1"></i><strong>Recency Boost</strong> <small class="fw-normal">(×${player.scoreBreakdown.recentBoostMultiplier})</small></span>
                        <span class="fw-bold">×${player.scoreBreakdown.recentBoostMultiplier}</span>
                    </div>
                    <div class="d-flex justify-content-between align-items-center py-1 border-bottom text-secondary">
                        <span><i class="bi bi-calculator me-1"></i>Total Penalty</span>
                        <span class="fw-bold">−${player.scoreBreakdown.totalPenalty.toFixed(1)}</span>
                    </div>` : ''}
                    <div class="d-flex justify-content-between align-items-center py-1 mt-1 fw-bold" style="border-top: 2px solid currentColor;">
                        <span><i class="bi bi-check-circle-fill me-1" style="color: var(--bs-${scoreInfo.badge});"></i>Final MSI</span>
                        <span style="color: var(--bs-${scoreInfo.badge});">${player.score}</span>
                    </div>
                </div>
            </div>
            </div>
            <!-- MMI Panel (right) -->
            <div class="col-md-6">
            ${ (() => {
                const mmi = player.mmiBreakdown;
                const mmiScore = player.mmi ?? 0;
                const mmiClass = mmiScore >= 15 ? 'score-high' : mmiScore >= 5 ? 'score-medium' : 'score-low';
                const mmiBadge = mmiScore >= 15 ? 'danger' : mmiScore >= 5 ? 'warning' : 'success';
                const mmiLabel = mmi?.managementLevel || 'Low Management';
                const b = mmi?.breakdown || { highCount:0, moderateCount:0, minorCount:0, highConditions:[], moderateConditions:[], minorConditions:[] };
                return `
            <div class="h-100 p-3 rounded border">
                <div class="text-center mb-3">
                    <div class="score-circle ${mmiClass}" style="width:120px;height:120px;font-size:2.4rem;margin:0 auto;">${mmiScore}</div>
                    <div class="mt-2 fw-bold fs-5">MMI <small class="text-muted fw-normal" style="font-size:0.8rem;">Medical Management Index</small></div>
                    <h6 class="mt-1"><span class="badge bg-${mmiBadge}">${mmiLabel}</span></h6>
                </div>
                <h6 class="border-top pt-2">Operational Summary</h6>
                <div style="font-size:0.9rem;">
                    <div class="mb-1"><span class="badge bg-danger me-1">${b.highCount}</span><strong>High Risk</strong> <span class="text-muted small">(15+ pts)</span>${b.highConditions.length > 0 ? '<div class="ms-3 text-muted small">' + b.highConditions.join(', ') + '</div>' : ''}</div>
                    <div class="mb-1"><span class="badge bg-warning text-dark me-1">${b.moderateCount}</span><strong>Moderate Risk</strong> <span class="text-muted small">(5–14 pts)</span>${b.moderateConditions.length > 0 ? '<div class="ms-3 text-muted small">' + b.moderateConditions.join(', ') + '</div>' : ''}</div>
                    <div class="mb-1"><span class="badge bg-success me-1">${b.minorCount}</span><strong>Low Risk</strong> <span class="text-muted small">(0–4 pts)</span>${b.minorConditions.length > 0 ? '<div class="ms-3 text-muted small">' + b.minorConditions.join(', ') + '</div>' : ''}</div>
                    ${b.highCount === 0 && b.moderateCount === 0 && b.minorCount === 0 ? '<div class="text-muted">No management conditions identified</div>' : ''}
                </div>
                <div class="mt-2 pt-2 border-top">
                    <small><strong>Clinical Action:</strong> <span class="text-muted fst-italic">${mmi?.clinicalAction || 'Standard player care'}</span></small>
                </div>
            </div>
                `;
            })() }
            </div>
        </div>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header"><h5>Missed Time and Chronic Conditions</h5></div>
        <div class="card-body">
        <h6>Missed Time / Availability</h6>
        <p>${player.facts.availability?.availabilityNarrative || 'No data'}</p>
        ${(player.facts.availability?.missedGamesBySeason || []).length > 0 ? `
            <table class="table table-sm">
                <thead><tr><th>Season</th><th>Missed Games</th><th>Reason</th></tr></thead>
                <tbody>
                ${player.facts.availability.missedGamesBySeason.map(s => `
                    <tr><td>${s.season}</td><td>${s.missedGames}</td><td>${s.reason || 'N/A'}</td></tr>
                `).join('')}
                </tbody>
            </table>
        ` : ''}

        <h6 class="mt-3">Chronic Conditions</h6>
        <div>
            ${(() => {
                const flags = player.facts.flags || {};
                const imaging = player.facts.imagingFindings || [];

                // Helper: find earliest date for a condition from imaging
                const findEarliestDate = (matchTerms) => {
                    const matches = imaging.filter(img => {
                        const sf = img.structuredFindings || {};
                        return matchTerms.some(t => {
                            if (t === 'cartilage') return sf.cartilageDamage && sf.cartilageDamage !== 'None' && sf.cartilageDamage !== 'Unknown';
                            if (t === 'loose') return sf.looseBodies;
                            if (t === 'oa') return sf.postTraumaticArthritis || sf.degenerativeChange;
                            if (t === 'instability') return (img.imaging?.finding || '').toLowerCase().includes('instab');
                            if (t === 'stress') return sf.stressReactionOrFracture;
                            return false;
                        });
                    }).map(i => i.date).filter(Boolean).sort();
                    return matches.length > 0 ? matches[0] : null;
                };

                const conditions = [];
                if (flags.cartilageDegeneration) conditions.push({
                    label: 'Cartilage Degeneration', color: '#8B0000', textColor: '#fff',
                    severity: 'Serious', date: findEarliestDate(['cartilage']),
                    desc: 'Structural breakdown of joint cartilage — long-term joint health concern'
                });
                if (flags.looseBodies) conditions.push({
                    label: 'Loose Bodies', color: '#8B0000', textColor: '#fff',
                    severity: 'Serious', date: findEarliestDate(['loose']),
                    desc: 'Intra-articular loose fragments that may cause mechanical symptoms'
                });
                if (flags.osteoarthritisOrArthrosis) conditions.push({
                    label: 'Osteoarthritis / Arthrosis', color: '#CC3300', textColor: '#fff',
                    severity: 'Serious', date: findEarliestDate(['oa']),
                    desc: 'Degenerative joint disease — progressive wear of articular surfaces'
                });
                if (flags.recurrentInstability) conditions.push({
                    label: 'Recurrent Instability', color: '#FF8C00', textColor: '#fff',
                    severity: 'Moderate', date: findEarliestDate(['instability']),
                    desc: 'Repeated episodes of joint instability affecting performance and injury risk'
                });
                if (flags.stressFractureHistory) conditions.push({
                    label: 'Stress Fracture History', color: '#FF8C00', textColor: '#fff',
                    severity: 'Moderate', date: findEarliestDate(['stress']),
                    desc: 'Prior stress fracture indicating elevated bone stress risk'
                });
                if (conditions.length === 0) return `
                    <div class="d-flex align-items-center gap-2 p-2 rounded" style="background:#f0fff0;border:1px solid #228B22;">
                        <i class="bi bi-check-circle-fill" style="color:#228B22;"></i>
                        <span class="text-success fw-semibold">No chronic conditions identified</span>
                    </div>`;

                return `<div class="d-flex flex-column gap-2">${conditions.map(c => `
                    <div class="d-flex align-items-start gap-3 p-2 rounded" style="background:#fafafa;border-left:4px solid ${c.color};">
                        <div class="flex-shrink-0 text-center" style="min-width:64px;">
                            <span class="badge d-block" style="background-color:${c.color};color:${c.textColor};font-size:0.75rem;">${c.severity}</span>
                        </div>
                        <div class="flex-grow-1">
                            <div class="fw-semibold">${c.label}${c.date ? ` <span class="text-muted fw-normal small">· since ${formatDate(c.date)}</span>` : ''}</div>
                            <div class="text-muted" style="font-size:0.82rem;">${c.desc}</div>
                        </div>
                    </div>
                `).join('')}</div>`;
            })()}
        </div>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header d-flex justify-content-between align-items-center">
            <h5 class="mb-0">Critical Information</h5>
            <div>
                <button class="btn btn-sm btn-primary me-2" id="toggleDetailsBtn-${playerId}" onclick="toggleAllDetails(${playerId})">
                    <i class="bi bi-arrows-expand me-1" id="toggleIcon-${playerId}"></i> Expand details
                </button>
                <button class="btn btn-sm btn-success" onclick="downloadPlayerReport(${playerId})">
                    <i class="bi bi-download me-1"></i> Download
                </button>
            </div>
        </div>
        <div class="card-body">
        <h6>Injuries</h6>
        <table class="table table-sm">
            <thead><tr>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'injuries', 'injury')" style="cursor: pointer;">
                    Injury ${player.sortState.injuries.column === 'injury' ? (player.sortState.injuries.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'injuries', 'bodyRegion')" style="cursor: pointer;">
                    Body Region ${player.sortState.injuries.column === 'bodyRegion' ? (player.sortState.injuries.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'injuries', 'date')" style="cursor: pointer;">
                    Date ${player.sortState.injuries.column === 'date' ? (player.sortState.injuries.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'injuries', 'severity')" style="cursor: pointer;">
                    Severity ${player.sortState.injuries.column === 'severity' ? (player.sortState.injuries.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'injuries', 'status')" style="cursor: pointer;">
                    Status ${player.sortState.injuries.column === 'status' ? (player.sortState.injuries.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th style="width: 40px;"></th>
            </tr></thead>
            <tbody>
            ${sortedInjuries.map((inj, i) => {
                const sevBg = inj.severity === 'Major' ? '#8B0000' : inj.severity === 'Moderate' ? '#FF8C00' : '#228B22';
                const statusBg = (inj.currentStatus === 'Recovered' || inj.currentStatus === 'Asymptomatic') ? '#228B22' :
                                 (inj.currentStatus === 'Symptomatic' || inj.currentStatus === 'Ongoing') ? '#8B0000' : '#FF8C00';
                return `
                <tr class="injury-row-${playerId}-${i}" style="cursor: pointer; border-bottom: 1px solid #dee2e6;" onclick="toggleInjuryDetails(${playerId}, ${i})">
                    <td>${inj.injuryName || 'Unknown'}</td>
                    <td>${inj.bodyRegion || 'Unknown'} ${inj.side !== 'NA' ? `(${inj.side})` : ''}</td>
                    <td>${formatDate(inj.date)}</td>
                    <td>
                        <span class="badge" style="background-color:${sevBg};color:#fff;">
                            ${inj.severity === 'Major' ? 'Severe' : inj.severity === 'Minor' ? 'Mild' : (inj.severity || 'Unknown')}
                        </span>
                    </td>
                    <td>
                        <span class="badge" style="background-color:${statusBg};color:#fff;">
                            ${inj.currentStatus || 'Unknown'}
                        </span>
                    </td>
                    <td class="text-center">
                        <i class="bi bi-chevron-down injury-chevron-${playerId}-${i}" style="font-size: 0.85rem;"></i>
                    </td>
                </tr>
                <tr class="injury-details-${playerId}-${i}" style="display: none; background-color: #f8f9fa;">
                    <td colspan="6" class="p-3">
                        <div class="row">
                            <div class="col-md-4">
                                <h6 class="text-primary"><i class="bi bi-tag me-1"></i>Type Information</h6>
                                ${inj.typeReason ? `<p class="mb-2" style="font-size: 1.05rem;"><strong>Reason:</strong> ${inj.typeReason}</p>` : '<p class="text-muted">No type reason available</p>'}
                                ${inj.typeSourceDoc ? `<p class="mb-1" style="font-size: 1rem;"><strong>Document:</strong> <span class="badge bg-secondary">${inj.typeSourceDoc}</span></p>` : ''}
                                ${inj.typeSourceQuote ? `<p class="mb-0" style="font-size: 1rem;"><strong>Quote:</strong> <em>"${inj.typeSourceQuote}"</em></p>` : ''}
                            </div>
                            <div class="col-md-4">
                                <h6 class="text-warning"><i class="bi bi-exclamation-triangle me-1"></i>Severity Information</h6>
                                ${inj.severityReason ? `<p class="mb-2" style="font-size: 1.05rem;"><strong>Reason:</strong> ${inj.severityReason}</p>` : '<p class="text-muted">No severity reason available</p>'}
                                ${inj.severitySourceDoc ? `<p class="mb-1" style="font-size: 1rem;"><strong>Document:</strong> <span class="badge bg-secondary">${inj.severitySourceDoc}</span></p>` : ''}
                                ${inj.severitySourceQuote ? `<p class="mb-0" style="font-size: 1rem;"><strong>Quote:</strong> <em>"${inj.severitySourceQuote}"</em></p>` : ''}
                            </div>
                            <div class="col-md-4">
                                <h6 class="text-success"><i class="bi bi-activity me-1"></i>Status Information</h6>
                                ${inj.statusReason ? `<p class="mb-2" style="font-size: 1.05rem;"><strong>Reason:</strong> ${inj.statusReason}</p>` : '<p class="text-muted">No status reason available</p>'}
                                ${inj.statusSourceDoc ? `<p class="mb-1" style="font-size: 1rem;"><strong>Document:</strong> <span class="badge bg-secondary">${inj.statusSourceDoc}</span></p>` : ''}
                                ${inj.statusSourceQuote ? `<p class="mb-0" style="font-size: 1rem;"><strong>Quote:</strong> <em>"${inj.statusSourceQuote}"</em></p>` : ''}
                            </div>
                        </div>
                    </td>
                </tr>
            `;
            }).join('')}
            </tbody>
        </table>

        <h6 class="mt-3">Surgeries / Procedures</h6>
        <table class="table table-sm">
            <thead><tr>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'surgeries', 'procedure')" style="cursor: pointer;">
                    Procedure ${player.sortState.surgeries.column === 'procedure' ? (player.sortState.surgeries.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'surgeries', 'bodyRegion')" style="cursor: pointer;">
                    Body Region ${player.sortState.surgeries.column === 'bodyRegion' ? (player.sortState.surgeries.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'surgeries', 'date')" style="cursor: pointer;">
                    Date ${player.sortState.surgeries.column === 'date' ? (player.sortState.surgeries.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'surgeries', 'type')" style="cursor: pointer;">
                    Type ${player.sortState.surgeries.column === 'type' ? (player.sortState.surgeries.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'surgeries', 'outcome')" style="cursor: pointer;">
                    Outcome ${player.sortState.surgeries.column === 'outcome' ? (player.sortState.surgeries.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th style="width: 40px;"></th>
            </tr></thead>
            <tbody>
            ${sortedSurgeries.map((surg, i) => {
                // Invasiveness-based color: high-invasiveness → dark red, mid → orange, minor → dark green
                const cat = surg.procedureCategory || '';
                const typeBg = (cat === 'Reconstruction' || cat === 'ORIF') ? '#8B0000' :
                               (cat === 'Repair' || cat === 'Arthroscopy') ? '#FF8C00' : '#228B22';
                const res = surg.outcome?.residualSymptoms || '';
                const outcomeBg = (res === 'None') ? '#228B22' :
                                  (res === 'Severe') ? '#8B0000' :
                                  (res === 'Moderate') ? '#FF8C00' : '#DAA520';
                return `
                <tr class="surgery-row-${playerId}-${i}" style="cursor: pointer; border-bottom: 1px solid #dee2e6;" onclick="toggleSurgeryDetails(${playerId}, ${i})">
                    <td>${(surg.procedure || 'Unknown').replace(/,?\s*(left|right|bilateral|right shoulder|left shoulder|right knee|left knee|right hip|left hip|right ankle|left ankle|right elbow|left elbow|right wrist|left wrist)\b.*/i, '').trim()}</td>
                    <td>${surg.bodyRegion || 'Unknown'} ${surg.side !== 'NA' ? `(${surg.side})` : ''}</td>
                    <td>${formatDate(surg.date)}</td>
                    <td>
                        <span class="badge" style="background-color:${typeBg};color:#fff;">
                            ${surg.procedureCategory || 'Unknown'}
                        </span>
                    </td>
                    <td>
                        <span class="badge" style="background-color:${outcomeBg};color:#fff;">
                            ${surg.outcome?.residualSymptoms || 'Unknown'}
                        </span>
                    </td>
                    <td class="text-center">
                        <i class="bi bi-chevron-down surgery-chevron-${playerId}-${i}" style="font-size: 0.85rem;"></i>
                    </td>
                </tr>
                <tr class="surgery-details-${playerId}-${i}" style="display: none; background-color: #f8f9fa;">
                    <td colspan="6" class="p-3">
                        <div class="row">
                            <div class="col-md-6">
                                <h6 class="text-primary"><i class="bi bi-scissors me-1"></i>Procedure Category Information</h6>
                                ${surg.procedureCategoryReason ? `<p class="mb-2" style="font-size: 1.05rem;"><strong>Reason:</strong> ${surg.procedureCategoryReason}</p>` : '<p class="text-muted">No procedure category reason available</p>'}
                                ${surg.procedureCategorySourceDoc ? `<p class="mb-1" style="font-size: 1rem;"><strong>Document:</strong> <span class="badge bg-secondary">${surg.procedureCategorySourceDoc}</span></p>` : ''}
                                ${surg.procedureCategorySourceQuote ? `<p class="mb-0" style="font-size: 1rem;"><strong>Quote:</strong> <em>"${surg.procedureCategorySourceQuote}"</em></p>` : ''}
                            </div>
                            <div class="col-md-6">
                                <h6 class="text-success"><i class="bi bi-clipboard-check me-1"></i>Outcome Information</h6>
                                ${surg.outcome?.outcomeReason ? `<p class="mb-2" style="font-size: 1.05rem;"><strong>Reason:</strong> ${surg.outcome.outcomeReason}</p>` : '<p class="text-muted">No outcome reason available</p>'}
                                ${surg.outcome?.outcomeSourceDoc ? `<p class="mb-1" style="font-size: 1rem;"><strong>Document:</strong> <span class="badge bg-secondary">${surg.outcome.outcomeSourceDoc}</span></p>` : ''}
                                ${surg.outcome?.outcomeSourceQuote ? `<p class="mb-0" style="font-size: 1rem;"><strong>Quote:</strong> <em>"${surg.outcome.outcomeSourceQuote}"</em></p>` : ''}
                            </div>
                        </div>
                    </td>
                </tr>
            `;
            }).join('')}
            </tbody>
        </table>

        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header"><h5>Medical Timeline</h5></div>
        <div class="card-body">
        ${(() => {
            // Build comprehensive timeline from clinically significant injuries and surgeries only
            const timelineEvents = [];

            // Add only clinically significant injuries (not incidental MRI findings)
            (player.facts.injuries || []).forEach(inj => {
                if (!inj.date) return;
                
                // Filter criteria: Include only if injury meets at least one of these:
                // 1. Has actual time loss (games or practice)
                // 2. Is Major or Moderate severity
                // 3. Required surgery
                // 4. Required significant treatment (injections)
                const hasTimeLoss = (inj.timeLost?.missedGames > 0) || (inj.timeLost?.missedPracticeWeeks > 0);
                const isSignificantSeverity = inj.severity === 'Major' || inj.severity === 'Moderate';
                const hadSurgery = inj.treatment?.surgery === true;
                const hadSignificantTreatment = inj.treatment?.injection && 
                    inj.treatment.injection !== 'None' && 
                    inj.treatment.injection !== 'Unknown';
                
                const isClinicallySignificant = hasTimeLoss || isSignificantSeverity || hadSurgery || hadSignificantTreatment;
                
                if (isClinicallySignificant) {
                    const timeLossParts = [];
                    if (inj.timeLost?.missedGames > 0) timeLossParts.push(`${inj.timeLost.missedGames} game(s)`);
                    if (inj.timeLost?.missedPracticeWeeks > 0) timeLossParts.push(`${inj.timeLost.missedPracticeWeeks} practice week(s)`);

                    // Build concise clinical summary from available evidence fields
                    const summaryParts = [];
                    if (inj.clinicalSummary) {
                        summaryParts.push(inj.clinicalSummary);
                    } else {
                        if (inj.severityReason) summaryParts.push(inj.severityReason);
                        if (inj.statusReason && inj.statusReason !== inj.severityReason) summaryParts.push(inj.statusReason);
                        if (!summaryParts.length && inj.notes) summaryParts.push(inj.notes);
                    }
                    const clinicalSummary = summaryParts.join(' ').replace(/\.\s+/g, '. ').trim();

                    const sevHex = inj.severity === 'Major' ? '#8B0000' : inj.severity === 'Minor' ? '#228B22' : '#FF8C00';
                    const statHex = (inj.currentStatus === 'Recovered' || inj.currentStatus === 'Asymptomatic') ? '#228B22' :
                                    (inj.currentStatus === 'Symptomatic' || inj.currentStatus === 'Ongoing') ? '#8B0000' : '#FF8C00';
                    const missedGamesDetail = inj.timeLost?.specificGames ? inj.timeLost.specificGames : null;
                    timelineEvents.push({
                        date: inj.date,
                        type: 'injury',
                        icon: 'bi-bandaid-fill',
                        hexColor: sevHex,
                        statusHex: statHex,
                        title: inj.injuryName || 'Injury',
                        meta: `${inj.bodyRegion || 'Unknown'}${inj.side && inj.side !== 'NA' ? ` (${inj.side})` : ''} · ${inj.severity === 'Major' ? 'Severe' : inj.severity === 'Minor' ? 'Mild' : (inj.severity || 'Unknown')} ${inj.type || ''} · ${inj.mechanism || 'Unknown mechanism'}`,
                        clinicalSummary: clinicalSummary || null,
                        timeLoss: timeLossParts.length > 0 ? timeLossParts.join(', ') : null,
                        missedGamesDetail,
                        status: inj.currentStatus || null,
                        severityLabel: inj.severity === 'Major' ? 'Severe' : inj.severity === 'Minor' ? 'Mild' : (inj.severity || 'Unknown'),
                        sourceDoc: inj.severitySourceDoc || inj.statusSourceDoc || null,
                        sourceQuote: inj.severitySourceQuote || inj.statusSourceQuote || null,
                    });
                }
            });

            // Add surgeries
            (player.facts.surgeries || []).forEach(surg => {
                if (surg.date) {
                    // Build concise clinical summary for surgery
                    const surgSummaryParts = [];
                    if (surg.clinicalSummary) {
                        surgSummaryParts.push(surg.clinicalSummary);
                    } else {
                        if (surg.procedureCategoryReason) surgSummaryParts.push(surg.procedureCategoryReason);
                        if (surg.outcome?.outcomeReason) surgSummaryParts.push(surg.outcome.outcomeReason);
                    }
                    const surgClinicalSummary = surgSummaryParts.join(' ').replace(/\.\s+/g, '. ').trim();

                    const surgCat = surg.procedureCategory || '';
                    const surgHex = (surgCat === 'Reconstruction' || surgCat === 'ORIF') ? '#8B0000' :
                                    (surgCat === 'Repair' || surgCat === 'Arthroscopy') ? '#FF8C00' : '#228B22';
                    const resid = surg.outcome?.residualSymptoms || '';
                    const outcomeHex = resid === 'None' ? '#228B22' : resid === 'Severe' ? '#8B0000' : resid === 'Moderate' ? '#FF8C00' : '#DAA520';
                    timelineEvents.push({
                        date: surg.date,
                        type: 'surgery',
                        icon: 'bi-scissors',
                        hexColor: surgHex,
                        title: surg.procedure || 'Surgery',
                        meta: `${surg.bodyRegion || 'Unknown'}${surg.side && surg.side !== 'NA' ? ` (${surg.side})` : ''} · ${surg.procedureCategory || 'Unknown'}${surg.revision ? ' · Revision' : ''}`,
                        clinicalSummary: surgClinicalSummary || null,
                        timeLoss: null,
                        severityLabel: surgCat || 'Procedure',
                        outcome: resid || null,
                        outcomeHex,
                        sourceDoc: surg.procedureCategorySourceDoc || surg.outcome?.outcomeSourceDoc || null,
                        sourceQuote: surg.procedureCategorySourceQuote || surg.outcome?.outcomeSourceQuote || null,
                    });
                }
            });

            // Sort by date (most recent first)
            timelineEvents.sort((a, b) => new Date(b.date) - new Date(a.date));

            if (timelineEvents.length === 0) {
                return '<p class="text-muted">No timeline data available</p>';
            }

            // Group events by date to detect same-date linked events (no divider between them)
            const dateGroups = new Map();
            timelineEvents.forEach(ev => {
                if (!dateGroups.has(ev.date)) dateGroups.set(ev.date, []);
                dateGroups.get(ev.date).push(ev);
            });

            const legend = `
                <div class="d-flex flex-wrap gap-3 mb-3 p-2 rounded" style="background:#f8f9fa;font-size:0.8rem;">
                    <strong class="me-1">Legend:</strong>
                    <span><span style="display:inline-block;width:12px;height:12px;background:#8B0000;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>Severe / High-Invasiveness</span>
                    <span><span style="display:inline-block;width:12px;height:12px;background:#FF8C00;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>Moderate / Repair</span>
                    <span><span style="display:inline-block;width:12px;height:12px;background:#228B22;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>Mild / Minor Procedure</span>
                    <span><span style="display:inline-block;width:12px;height:12px;background:#DAA520;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>Partial / Mild Residual</span>
                    <span><i class="bi bi-bandaid-fill me-1"></i>Injury &nbsp; <i class="bi bi-scissors me-1"></i>Surgery</span>
                </div>
            `;

            const timelineHtml = [...dateGroups.entries()].sort((a,b)=>new Date(b[0])-new Date(a[0])).map(([date, events]) => {
                const isLinked = events.length > 1 && events.some(e=>e.type==='injury') && events.some(e=>e.type==='surgery');
                const groupWrapper = isLinked ? 'border rounded p-2 mb-3' : 'mb-3';
                const itemsHtml = events.map((event, idx) => {
                    const tlId = `tl-${playerId}-${date.replace(/\W/g,'')}-${idx}`;
                    const summaryLine = event.clinicalSummary
                        ? event.clinicalSummary.substring(0, 120) + (event.clinicalSummary.length > 120 ? '…' : '')
                        : event.meta;
                    return `
                        <div class="${!isLinked ? 'border-bottom pb-2' : ''}">
                            <div class="d-flex align-items-start">
                                <div class="me-3 pt-1" style="color:${event.hexColor};">
                                    <i class="bi ${event.icon} fs-4"></i>
                                </div>
                                <div class="flex-grow-1">
                                    <div class="d-flex align-items-center flex-wrap gap-2 mb-1">
                                        <span class="badge" style="background-color:${event.hexColor};color:#fff;">${event.type.toUpperCase()}</span>
                                        <strong>${event.title}</strong>
                                        <span class="text-muted small">${formatDate(event.date)}</span>
                                        ${event.timeLoss ? `<span class="badge" style="background:#6c1a1a;color:#fff;"><i class="bi bi-clock me-1"></i>${event.timeLoss}</span>` : ''}
                                        ${event.status ? `<span class="badge" style="background-color:${event.statusHex || event.hexColor};color:#fff;">${event.status}</span>` : ''}
                                        ${event.outcome ? `<span class="badge" style="background-color:${event.outcomeHex};color:#fff;">Residual: ${event.outcome}</span>` : ''}
                                    </div>
                                    ${event.clinicalSummary ? `<div class="small mb-1" style="color:#444;">${event.clinicalSummary}</div>` : ''}
                                    <details id="${tlId}">
                                        <summary class="text-primary small" style="cursor:pointer;user-select:none;">Show detail</summary>
                                        <div class="mt-2 ps-2 border-start border-2" style="border-color:${event.hexColor} !important;">
                                            ${event.meta ? `<p class="mb-1 small"><strong>Details:</strong> ${event.meta}</p>` : ''}
                                            ${event.missedGamesDetail ? `<p class="mb-1 small"><strong>Specific Games Missed:</strong> ${event.missedGamesDetail}</p>` : ''}
                                            ${event.sourceDoc ? `<p class="mb-1 small"><strong>Source:</strong> <span class="badge bg-secondary">${event.sourceDoc}</span></p>` : ''}
                                            ${event.sourceQuote ? `<p class="mb-0 small"><strong>Quote:</strong> <em>"${event.sourceQuote}"</em></p>` : ''}
                                        </div>
                                    </details>
                                </div>
                            </div>
                        </div>
                    `;
                }).join(isLinked ? '<div class="my-2" style="border-top:1px dashed #ccc;opacity:0.5;"></div>' : '');

                return `<div class="${groupWrapper}">${isLinked ? `<div class="text-muted small mb-1"><i class="bi bi-link-45deg me-1"></i>Linked events on ${formatDate(date)}</div>` : ''}${itemsHtml}</div>`;
            }).join('');

            return `${legend}<div class="timeline">${timelineHtml}</div>`;
        })()}
        </div>
    </div>

    ${(() => {
        const imgs = player.facts.imagingFindings || [];
        if (imgs.length === 0) return '';

        // Determine date range of imaging
        const imgDates = imgs.map(i => i.date).filter(Boolean).sort();
        const dateRangeText = imgDates.length > 1
            ? `${formatDate(imgDates[0])} – ${formatDate(imgDates[imgDates.length - 1])}`
            : imgDates.length === 1 ? formatDate(imgDates[0]) : 'N/A';

        // Helper: score severity of structured findings (for color coding)
        const sfSeverityHex = (sf) => {
            if (!sf) return '#228B22';
            if (sf.nonunionOrDelayedUnion || sf.avascularNecrosisConcern || sf.looseBodies || sf.postTraumaticArthritis ||
                (sf.cartilageDamage && /full|severe/i.test(sf.cartilageDamage))) return '#8B0000';
            if (sf.stressReactionOrFracture || (sf.cartilageDamage && /moderate/i.test(sf.cartilageDamage)) ||
                sf.labrumMeniscusStatus && /tear|rupture/i.test(sf.labrumMeniscusStatus) ||
                (sf.hardwareComplication && sf.hardwareComplication !== 'None' && sf.hardwareComplication !== 'Unknown') ||
                (sf.degenerativeChange && /severe|moderate/i.test(sf.degenerativeChange))) return '#FF8C00';
            if (sf.effusion || sf.tendonStatus || sf.ligamentStatus || sf.labrumMeniscusStatus || sf.degenerativeChange) return '#DAA520';
            return '#228B22';
        };

        const sfSeverityLabel = (sf) => {
            if (!sf) return 'Normal';
            if (sf.nonunionOrDelayedUnion || sf.avascularNecrosisConcern || sf.looseBodies || sf.postTraumaticArthritis ||
                (sf.cartilageDamage && /full|severe/i.test(sf.cartilageDamage))) return 'Severe';
            if (sf.stressReactionOrFracture || (sf.cartilageDamage && /moderate/i.test(sf.cartilageDamage)) ||
                (sf.hardwareComplication && sf.hardwareComplication !== 'None' && sf.hardwareComplication !== 'Unknown') ||
                (sf.degenerativeChange && /severe|moderate/i.test(sf.degenerativeChange))) return 'Moderate';
            if (sf.effusion || sf.tendonStatus || sf.ligamentStatus || sf.labrumMeniscusStatus || sf.degenerativeChange) return 'Mild';
            return 'Normal';
        };

        const renderSFList = (sf) => {
            if (!sf) return '';
            const lines = [];
            if (sf.degenerativeChange && sf.degenerativeChange !== 'None' && sf.degenerativeChange !== 'Unknown') lines.push(`Degenerative Change: ${sf.degenerativeChange}`);
            if (sf.cartilageDamage && sf.cartilageDamage !== 'None' && sf.cartilageDamage !== 'Unknown') lines.push(`Cartilage Damage: ${sf.cartilageDamage}`);
            if (sf.labrumMeniscusStatus && sf.labrumMeniscusStatus !== 'Normal' && sf.labrumMeniscusStatus !== 'Unknown') lines.push(`Labrum/Meniscus: ${sf.labrumMeniscusStatus}`);
            if (sf.tendonStatus && sf.tendonStatus !== 'Normal' && sf.tendonStatus !== 'Unknown') lines.push(`Tendon: ${sf.tendonStatus}`);
            if (sf.ligamentStatus && sf.ligamentStatus !== 'Normal' && sf.ligamentStatus !== 'Unknown') lines.push(`Ligament: ${sf.ligamentStatus}`);
            if (sf.effusion && sf.effusion !== 'None' && sf.effusion !== 'Unknown') lines.push(`Effusion: ${sf.effusion}`);
            if (sf.looseBodies) lines.push('Loose Bodies: Present');
            if (sf.nonunionOrDelayedUnion) lines.push('Nonunion/Delayed Union: Present');
            if (sf.avascularNecrosisConcern) lines.push('AVN Concern: Present');
            if (sf.postTraumaticArthritis) lines.push('Post-Traumatic Arthritis: Present');
            if (sf.stressReactionOrFracture) lines.push('Stress Reaction/Fracture: Present');
            if (sf.hardwareComplication && sf.hardwareComplication !== 'None' && sf.hardwareComplication !== 'Unknown') lines.push(`Hardware Complication: ${sf.hardwareComplication}`);
            return lines;
        };

        // Group by bodyRegion + side
        const groups = new Map();
        imgs.forEach(img => {
            const key = `${img.bodyRegion || 'Other'}|${img.side && img.side !== 'NA' ? img.side : ''}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(img);
        });

        // For each group, compute aggregate severity and summarise findings
        const tableRows = [...groups.entries()].map(([key, entries]) => {
            const [region, side] = key.split('|');
            const regionLabel = side ? `${region} (${side})` : region;
            const sorted = [...entries].sort((a,b) => new Date(b.date)-new Date(a.date));
            const latest = sorted[0];

            // Aggregate all findings across all scans in this group
            const allFindings = new Set();
            let worstSeverityHex = '#228B22';
            let worstSeverityLabel = 'Normal';
            const severityOrder = { 'Severe': 3, 'Moderate': 2, 'Mild': 1, 'Normal': 0 };
            sorted.forEach(e => {
                const hex = sfSeverityHex(e.structuredFindings);
                const lab = sfSeverityLabel(e.structuredFindings);
                if ((severityOrder[lab] || 0) > (severityOrder[worstSeverityLabel] || 0)) {
                    worstSeverityHex = hex;
                    worstSeverityLabel = lab;
                }
                renderSFList(e.structuredFindings).forEach(f => allFindings.add(f));
            });
            const modalities = [...new Set(sorted.map(e => e.modality).filter(Boolean))].join(' / ');
            const summaryFindings = [...allFindings].slice(0, 3).join('; ') + (allFindings.size > 3 ? ` +${allFindings.size-3} more` : '');

            // Breakdown by modality for expanded view
            const modalityGroups = new Map();
            sorted.forEach(e => {
                const mod = e.modality || 'Unknown';
                if (!modalityGroups.has(mod)) modalityGroups.set(mod, []);
                modalityGroups.get(mod).push(e);
            });

            const expandedRows = [...modalityGroups.entries()].map(([mod, scans]) => {
                return scans.map(scan => {
                    const sf = scan.structuredFindings || {};
                    // Map each finding to its own per-field severity color
                    const fieldColors = {
                        'Degenerative Change': /severe|moderate/i.test(sf.degenerativeChange||'') ? '#FF8C00' : '#DAA520',
                        'Cartilage Damage': /full|severe/i.test(sf.cartilageDamage||'') ? '#8B0000' : /moderate/i.test(sf.cartilageDamage||'') ? '#FF8C00' : '#DAA520',
                        'Labrum/Meniscus': /tear|rupture/i.test(sf.labrumMeniscusStatus||'') ? '#FF8C00' : '#DAA520',
                        'Tendon': /rupture|tear/i.test(sf.tendonStatus||'') ? '#FF8C00' : '#DAA520',
                        'Ligament': /tear|rupture/i.test(sf.ligamentStatus||'') ? '#FF8C00' : '#DAA520',
                        'Effusion': '#DAA520',
                        'Loose Bodies': '#8B0000',
                        'Nonunion/Delayed Union': '#8B0000',
                        'AVN Concern': '#8B0000',
                        'Post-Traumatic Arthritis': '#8B0000',
                        'Stress Reaction/Fracture': '#FF8C00',
                        'Hardware Complication': /severe/i.test(sf.hardwareComplication||'') ? '#8B0000' : '#FF8C00',
                    };
                    const sfLines = renderSFList(scan.structuredFindings);
                    return `
                        <tr style="background:#fdfdfd;">
                            <td class="ps-4 text-muted small">${mod}</td>
                            <td class="text-muted small">${formatDate(scan.date)}</td>
                            <td colspan="2">
                                ${scan.imaging?.finding ? `<p class="mb-1 small"><em>${scan.imaging.finding}</em></p>` : ''}
                                ${sfLines.length ? `<div class="small">${sfLines.map(l => {
                                    const key = Object.keys(fieldColors).find(k => l.startsWith(k));
                                    const hex = key ? fieldColors[key] : '#6c757d';
                                    return `<span class="badge me-1 mb-1" style="background-color:${hex};color:#fff;font-weight:normal;">${l}</span>`;
                                }).join('')}</div>` : '<span class="text-muted small">No structured findings</span>'}
                            </td>
                        </tr>
                    `;
                }).join('');
            }).join('');

            const expandId = `rad-expand-${playerId}-${key.replace(/\W/g,'_')}`;

            return `
                <tr style="cursor:pointer;" onclick="toggleRadiologyExpand('${expandId}', this)">
                    <td>
                        <strong>${regionLabel}</strong>
                    </td>
                    <td class="text-muted small">${formatDate(latest.date)}</td>
                    <td>
                        <span class="badge me-1" style="background-color:${worstSeverityHex};color:#fff;">${worstSeverityLabel}</span>
                        <span class="text-muted small">${summaryFindings || 'No significant findings'}</span>
                    </td>
                    <td class="text-muted small">${modalities}</td>
                    <td class="text-center"><i class="bi bi-chevron-down" id="chev-${expandId}" style="font-size:0.85rem;"></i></td>
                </tr>
                <tr id="${expandId}" style="display:none;background:#f8f9fa;">
                    <td colspan="5" class="p-0">
                        <table class="table table-sm mb-0">
                            <thead style="background:#e9ecef;"><tr>
                                <th class="ps-4">Modality</th><th>Date</th><th colspan="2">Findings &amp; Impression</th>
                            </tr></thead>
                            <tbody>${expandedRows}</tbody>
                        </table>
                    </td>
                </tr>
            `;
        }).join('');

        return `
    <div class="card mb-3" id="radiology-card-${playerId}">
        <div class="card-header d-flex justify-content-between align-items-center">
            <h5 class="mb-0"><i class="bi bi-radioactive me-2 text-primary"></i>Radiology Findings</h5>
            <small class="text-muted">Date range: ${dateRangeText}</small>
        </div>
        <div class="card-body p-0">
            <div class="px-3 pt-2 pb-1">
                <div class="d-flex flex-wrap gap-3 mb-2" style="font-size:0.8rem;">
                    <strong class="me-1">Severity:</strong>
                    <span><span style="display:inline-block;width:12px;height:12px;background:#8B0000;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>Severe</span>
                    <span><span style="display:inline-block;width:12px;height:12px;background:#FF8C00;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>Moderate</span>
                    <span><span style="display:inline-block;width:12px;height:12px;background:#DAA520;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>Mild</span>
                    <span><span style="display:inline-block;width:12px;height:12px;background:#228B22;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>Normal</span>
                    <span class="text-muted">· Click any row to expand by modality</span>
                </div>
            </div>
            <table class="table table-sm table-hover mb-0">
                <thead class="table-light"><tr>
                    <th>Body Part</th>
                    <th>Latest Scan</th>
                    <th>Structured Findings Summary</th>
                    <th>Modalities</th>
                    <th style="width:40px;"></th>
                </tr></thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    </div>
        `;
    })()}
    `;
    // Initialize Bootstrap popovers (for imaging findings if any remain)
    setTimeout(() => {
        const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
        [...popoverTriggerList].map(popoverTriggerEl => new bootstrap.Popover(popoverTriggerEl));
    }, 100);
}

// Make functions globally accessible
window.toggleRadiologyExpand = function(expandId, rowEl) {
    const expandRow = document.getElementById(expandId);
    const chevron = document.getElementById('chev-' + expandId);
    if (!expandRow) return;
    if (expandRow.style.display === 'none' || expandRow.style.display === '') {
        expandRow.style.display = 'table-row';
        if (chevron) { chevron.classList.remove('bi-chevron-down'); chevron.classList.add('bi-chevron-up'); }
    } else {
        expandRow.style.display = 'none';
        if (chevron) { chevron.classList.remove('bi-chevron-up'); chevron.classList.add('bi-chevron-down'); }
    }
};

window.toggleInjuryDetails = function(playerId, injuryIndex) {
    const detailsRow = document.querySelector(`.injury-details-${playerId}-${injuryIndex}`);
    const chevron = document.querySelector(`.injury-chevron-${playerId}-${injuryIndex}`);
    
    if (detailsRow.style.display === 'none' || detailsRow.style.display === '') {
        detailsRow.style.display = 'table-row';
        chevron.classList.remove('bi-chevron-down');
        chevron.classList.add('bi-chevron-up');
    } else {
        detailsRow.style.display = 'none';
        chevron.classList.remove('bi-chevron-up');
        chevron.classList.add('bi-chevron-down');
    }
};

window.toggleSurgeryDetails = function(playerId, surgeryIndex) {
    const detailsRow = document.querySelector(`.surgery-details-${playerId}-${surgeryIndex}`);
    const chevron = document.querySelector(`.surgery-chevron-${playerId}-${surgeryIndex}`);
    if (detailsRow.style.display === 'none' || detailsRow.style.display === '') {
        detailsRow.style.display = 'table-row';
        chevron.classList.remove('bi-chevron-down');
        chevron.classList.add('bi-chevron-up');
    } else {
        detailsRow.style.display = 'none';
        chevron.classList.remove('bi-chevron-up');
        chevron.classList.add('bi-chevron-down');
    }
};

window.toggleImagingDetails = function(playerId, imagingIndex) {
    const detailsRow = document.querySelector(`.imaging-details-${playerId}-${imagingIndex}`);
    const chevron = document.querySelector(`.imaging-chevron-${playerId}-${imagingIndex}`);
    if (detailsRow.style.display === 'none' || detailsRow.style.display === '') {
        detailsRow.style.display = 'table-row';
        chevron.classList.remove('bi-chevron-down');
        chevron.classList.add('bi-chevron-up');
    } else {
        detailsRow.style.display = 'none';
        chevron.classList.remove('bi-chevron-up');
        chevron.classList.add('bi-chevron-down');
    }
};

window.toggleAllDetails = function(playerId) {
    const player = players.find(p => p.id === playerId);
    if (!player) return;
    
    // Check if any detail is currently expanded to determine toggle direction
    const firstInjuryDetails = document.querySelector(`.injury-details-${playerId}-0`);
    const shouldExpand = !firstInjuryDetails || firstInjuryDetails.style.display === 'none' || firstInjuryDetails.style.display === '';
    
    // Toggle all injury details
    const injuries = player.facts.injuries || [];
    injuries.forEach((_, i) => {
        const detailsRow = document.querySelector(`.injury-details-${playerId}-${i}`);
        const chevron = document.querySelector(`.injury-chevron-${playerId}-${i}`);
        if (detailsRow) {
            if (shouldExpand) {
                detailsRow.style.display = 'table-row';
                chevron.classList.remove('bi-chevron-down');
                chevron.classList.add('bi-chevron-up');
            } else {
                detailsRow.style.display = 'none';
                chevron.classList.remove('bi-chevron-up');
                chevron.classList.add('bi-chevron-down');
            }
        }
    });
    
    // Toggle all surgery details
    const surgeries = player.facts.surgeries || [];
    surgeries.forEach((_, i) => {
        const detailsRow = document.querySelector(`.surgery-details-${playerId}-${i}`);
        const chevron = document.querySelector(`.surgery-chevron-${playerId}-${i}`);
        if (detailsRow) {
            if (shouldExpand) {
                detailsRow.style.display = 'table-row';
                chevron.classList.remove('bi-chevron-down');
                chevron.classList.add('bi-chevron-up');
            } else {
                detailsRow.style.display = 'none';
                chevron.classList.remove('bi-chevron-up');
                chevron.classList.add('bi-chevron-down');
            }
        }
    });
    
    // Toggle all imaging findings
    const imagingFindings = player.facts.imagingFindings || [];
    imagingFindings.forEach((_, i) => {
        const detailsRow = document.querySelector(`.imaging-details-${playerId}-${i}`);
        const chevron = document.querySelector(`.imaging-chevron-${playerId}-${i}`);
        if (detailsRow) {
            if (shouldExpand) {
                detailsRow.style.display = 'table-row';
                chevron.classList.remove('bi-chevron-down');
                chevron.classList.add('bi-chevron-up');
            } else {
                detailsRow.style.display = 'none';
                chevron.classList.remove('bi-chevron-up');
                chevron.classList.add('bi-chevron-down');
            }
        }
    });
    
    // Update button icon
    const toggleIcon = document.getElementById(`toggleIcon-${playerId}`);
    if (toggleIcon) {
        if (shouldExpand) {
            toggleIcon.classList.remove('bi-arrows-expand');
            toggleIcon.classList.add('bi-arrows-collapse');
        } else {
            toggleIcon.classList.remove('bi-arrows-collapse');
            toggleIcon.classList.add('bi-arrows-expand');
        }
    }
};

window.downloadPlayerReport = function(playerId) {
    const player = players.find(p => p.id === playerId);
    if (!player) return;
    // Don't include compare section in PDF
    const hasCompareData = false;
    // Don't toggle - print exactly as displayed on UI
    // Create a style element for print-specific styles
    const printStyle = document.createElement('style');
    printStyle.id = 'print-styles';
    printStyle.innerHTML = getPrintStyles(player.name, hasCompareData);
    // Add print styles to document
    document.head.appendChild(printStyle);
    // Set document title for the PDF filename
    const originalTitle = document.title;
    document.title = `${player.name}_Medical_Report${hasCompareData ? '_with_Comparison' : ''}`;
    // Trigger print dialog
    window.print();
    // Restore original title and remove print styles after a short delay
    setTimeout(() => {
        document.title = originalTitle;
        const styleElement = document.getElementById('print-styles');
        if (styleElement) {    styleElement.remove(); }}, 1000);
};

// ========== TAB C: COMPARE PLAYERS ==========
function renderCompareCheckboxes() {
    const container = document.getElementById('compareCheckboxes');
    container.innerHTML = '';
    players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'form-check';
    div.innerHTML = `
        <input class="form-check-input compare-checkbox" type="checkbox" value="${p.id}" id="cmp${p.id}">
        <label class="form-check-label" for="cmp${p.id}">${p.name}</label>
    `;
    container.appendChild(div);
    });

    document.querySelectorAll('.compare-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
        const id = parseInt(e.target.value);
        if (e.target.checked) {  selectedComparePlayers.add(id); } 
        else { selectedComparePlayers.delete(id); }
        renderCompareTable();
    });
    });
}

let compareTableSort = { column: 'score', direction: 'desc' };

function renderCompareTable() {
    const tbody = document.getElementById('compareTableBody');
    tbody.innerHTML = '';
    let selected = players.filter(p => selectedComparePlayers.has(p.id));
    // Sort the selected players
    selected.sort((a, b) => {
        let aVal, bVal;
        switch(compareTableSort.column) {
            case 'name':
                aVal = a.name.toLowerCase();
                bVal = b.name.toLowerCase();
                break;
            case 'draftYear':
                aVal = a.draftYear || 0;
                bVal = b.draftYear || 0;
                break;
            case 'surgeries':
                aVal = (a.facts?.summaryCounts?.surgeriesTotal || 0);
                bVal = (b.facts?.summaryCounts?.surgeriesTotal || 0);
                break;
            case 'recurrence':
                aVal = (a.facts?.summaryCounts?.recurrenceTotal || 0);
                bVal = (b.facts?.summaryCounts?.recurrenceTotal || 0);
                break;
            case 'missedGames':
                aVal = (a.facts?.summaryCounts?.missedGamesTotal || 0);
                bVal = (b.facts?.summaryCounts?.missedGamesTotal || 0);
                break;
            case 'score':
                aVal = a.score || 0;
                bVal = b.score || 0;
                break;
            default:
                return 0;
        }
        if (aVal < bVal) return compareTableSort.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return compareTableSort.direction === 'asc' ? 1 : -1;
        return 0;
    });
    selected.forEach(p => {
        // Ensure score is valid
        if (p.score === undefined || p.score === null || isNaN(p.score)) {
            const result = calculateMSI(p.facts || {});
            p.score = result.msi;
            p.scoreBreakdown = result.breakdown;
        }
        const scoreInfo = getScoreLabel(p.score);
        const counts = p.facts?.summaryCounts || {};
        const flags = p.facts?.flags || {};
        // Build imaging flags list
        const imagingFlags = [];
        if (flags.cartilageDegeneration) imagingFlags.push('Cartilage');
        if (flags.looseBodies) imagingFlags.push('Loose Bodies');
        if (flags.osteoarthritisOrArthrosis) imagingFlags.push('Arthritis');
        if (flags.fractureNonunionOrDelayedUnion) imagingFlags.push('Nonunion');
        if (flags.avascularNecrosisConcern) imagingFlags.push('AVN');
        if (flags.hardwareFailureOrBrokenImplant) imagingFlags.push('Hardware');
        if ((counts.cervicalNeurologicEventsTotal || 0) > 0) imagingFlags.push('Cervical');
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${p.name}</strong></td>
            <td>${p.draftYear || 'N/A'}</td>
            <td>${counts.surgeriesTotal || 0}</td>
            <td>${(counts.concussionsTotal || 0) > 0 ? '<span class="badge bg-warning">Yes</span>' : '<span class="badge bg-success">No</span>'}</td>
            <td>${counts.recurrenceTotal || 0}</td>
            <td>
            ${imagingFlags.length > 0 ? imagingFlags.map(flag => `<span class="badge bg-danger me-1">${flag}</span>`).join('') : '<span class="text-muted">None</span>'}
            </td>
            <td>${counts.missedGamesTotal || 0}</td>
            <td><span class="badge bg-${scoreInfo.badge} fs-6">${isNaN(p.score) ? 'N/A' : p.score}</span></td>
        `;
        tbody.appendChild(row);
    });
}

function sortCompareTableBy(column) {
    if (compareTableSort.column === column) {
        compareTableSort.direction = compareTableSort.direction === 'asc' ? 'desc' : 'asc';
    } else { compareTableSort.column = column; compareTableSort.direction = 'desc';  }
    renderCompareTable();
}

// Sorting for compare table - will be initialized after DOM loads
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('.sortable').forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => { const sortKey = th.dataset.sort; sortCompareTableBy(sortKey); });
        });
    });
}

// Export to PDF
document.getElementById('exportPDF').addEventListener('click', (e) => {
    e.preventDefault();
    const selected = players.filter(p => selectedComparePlayers.has(p.id));
    if (selected.length === 0) { showToast('Please select at least one player to export', 'warning');  return; }
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l', 'mm', 'a4'); // landscape orientation
        // Add title
        doc.setFontSize(16);
        doc.setTextColor(40);
        doc.text('Player Medical Comparison Report', 14, 15);
        // Add date
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 22);
        // Prepare table data
        const tableData = selected.map(p => {
            const counts = p.facts.summaryCounts || {};
            const flags = p.facts.flags || {};
            const scoreInfo = getScoreLabel(p.score);
            // Build imaging flags list
            const imagingFlags = [];
            if (flags.cartilageDegeneration) imagingFlags.push('Cartilage');
            if (flags.looseBodies) imagingFlags.push('Loose Bodies');
            if (flags.osteoarthritisOrArthrosis) imagingFlags.push('Arthritis');
            if (flags.fractureNonunionOrDelayedUnion) imagingFlags.push('Nonunion');
            if (flags.avascularNecrosisConcern) imagingFlags.push('AVN');
            if (flags.hardwareFailureOrBrokenImplant) imagingFlags.push('Hardware');
            if ((counts.cervicalNeurologicEventsTotal || 0) > 0) imagingFlags.push('Cervical');
            return [
                p.name,
                p.draftYear || 'N/A',
                counts.surgeriesTotal || 0,
                (counts.concussionsTotal || 0) > 0 ? 'Yes' : 'No',
                counts.recurrenceTotal || 0,
                imagingFlags.length > 0 ? imagingFlags.join(', ') : 'None',
                counts.missedGamesTotal || 0,
                p.score,
                scoreInfo.label
            ];
        });
        
        // Define table columns
        const columns = [
            { header: 'Player', dataKey: 'player' },
            { header: 'Draft Year', dataKey: 'draftYear' },
            { header: 'Surgeries', dataKey: 'surgeries' },
            { header: 'Concussion', dataKey: 'concussion' },
            { header: 'Recurring', dataKey: 'recurring' },
            { header: 'Imaging Flags', dataKey: 'flags' },
            { header: 'Missed Games', dataKey: 'missedGames' },
            { header: 'Score', dataKey: 'score' },
            { header: 'Risk Level', dataKey: 'risk' }
        ];
        
        // Generate table with autoTable
        doc.autoTable({
            startY: 28,
            head: [columns.map(col => col.header)],
            body: tableData,
            theme: 'grid',
            headStyles: { fillColor: [33, 37, 41], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center'},
            bodyStyles: { fontSize: 9, cellPadding: 3 },
            columnStyles: {
                0: { cellWidth: 35 }, // Player
                1: { cellWidth: 20, halign: 'center' }, // Draft Year
                2: { cellWidth: 20, halign: 'center' }, // Surgeries
                3: { cellWidth: 20, halign: 'center' }, // Concussion
                4: { cellWidth: 20, halign: 'center' }, // Recurring
                5: { cellWidth: 50 }, // Flags
                6: { cellWidth: 25, halign: 'center' }, // Missed Games
                7: { cellWidth: 18, halign: 'center' }, // Score
                8: { cellWidth: 30, halign: 'center' } // Risk Level
            },
            didParseCell: function(data) {
                // Color code the concussion column
                if (data.column.index === 3 && data.section === 'body') {
                    if (data.cell.text[0] === 'Yes') {
                        data.cell.styles.fillColor = [255, 243, 205]; // warning yellow
                        data.cell.styles.textColor = [0, 0, 0];
                    } else {
                        data.cell.styles.fillColor = [212, 237, 218]; // success green
                        data.cell.styles.textColor = [0, 0, 0];
                    }
                }
                
                // Color code the score column
                if (data.column.index === 7 && data.section === 'body') {
                    const score = parseInt(data.cell.text[0]);
                    if (score >= 75) {
                        data.cell.styles.fillColor = [40, 167, 69]; // success green
                        data.cell.styles.textColor = [255, 255, 255];
                        data.cell.styles.fontStyle = 'bold';
                    } else if (score >= 50) {
                        data.cell.styles.fillColor = [255, 193, 7]; // warning yellow
                        data.cell.styles.textColor = [0, 0, 0];
                        data.cell.styles.fontStyle = 'bold';
                    } else {
                        data.cell.styles.fillColor = [220, 53, 69]; // danger red
                        data.cell.styles.textColor = [255, 255, 255];
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
                
                // Color code the risk level column
                if (data.column.index === 8 && data.section === 'body') {
                    if (data.cell.text[0] === 'Low Risk') {
                        data.cell.styles.fillColor = [40, 167, 69]; // success green
                        data.cell.styles.textColor = [255, 255, 255];
                        data.cell.styles.fontStyle = 'bold';
                    } else if (data.cell.text[0] === 'Moderate Risk') {
                        data.cell.styles.fillColor = [255, 193, 7]; // warning yellow
                        data.cell.styles.textColor = [0, 0, 0];
                        data.cell.styles.fontStyle = 'bold';
                    } else if (data.cell.text[0] === 'High Risk') {
                        data.cell.styles.fillColor = [220, 53, 69]; // danger red
                        data.cell.styles.textColor = [255, 255, 255];
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
                
                // Highlight imaging flags if present
                if (data.column.index === 5 && data.section === 'body') {
                    if (data.cell.text[0] !== 'None') {
                        data.cell.styles.fillColor = [248, 215, 218]; // light red
                        data.cell.styles.textColor = [0, 0, 0];
                    }
                }
            }
        });
        
        // Add footer
        const pageCount = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(150);
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 10);
        }
        // Save the PDF
        doc.save('player-comparison.pdf');
        showToast('PDF exported successfully!');
    } catch (error) {
        console.error('PDF Export Error:', error);
        showToast('Error exporting PDF: ' + error.message, 'danger');
    }
});

// ========== TOAST ==========
function showToast(message, type = 'success') {
    const toastContainer = document.createElement('div');
    toastContainer.className = 'position-fixed bottom-0 end-0 p-3';
    toastContainer.style.zIndex = 11;
    const bgClass = type === 'danger' ? 'bg-danger text-white' : '';
    toastContainer.innerHTML = `
    <div class="toast show ${bgClass}" role="alert">
        <div class="toast-header">
        <strong class="me-auto">${type === 'danger' ? 'Error' : 'Success'}</strong>
        <button type="button" class="btn-close" data-bs-dismiss="toast"></button>
        </div>
        <div class="toast-body">${message}</div>
    </div>
    `;
    document.body.appendChild(toastContainer);
    setTimeout(() => toastContainer.remove(), 5000);
}

// ========== EVENT LISTENERS ==========
document.getElementById('config-btn').addEventListener('click', () => initLLM(true));
document.getElementById('model-select').addEventListener('change', (e) => {
    currentModel = e.target.value;
});

// ========== INIT ==========
renderPlayerSelector();
renderCompareCheckboxes();