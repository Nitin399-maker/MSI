import { openaiConfig } from "bootstrap-llm-provider";
import { bootstrapAlert } from "bootstrap-alert";
import { calculateMSI, MEDICAL_ANALYSIS_PROMPT, getPrintStyles } from "./util.js";

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
    if (validScore >= 50) return { label: "Moderate Risk", class: "score-medium", badge: "warning" };
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
            console.log(`Score calculated for ${p.name}: ${p.score}`, result.breakdown);
        } catch (error) {
            console.error(`Error calculating score for ${p.name}:`, error);
            p.score = 100;
            p.scoreBreakdown = {
                orthoPenalty: 0,
                redFlagPenalty: 0,
                availabilityPenalty: 0,
                neuroPenalty: 0,
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
        <div class="row">
            <div class="col-md-4 text-center">
            <div class="score-circle ${scoreInfo.class}">${player.score}</div>
            <h5 class="mt-3"><span class="badge bg-${scoreInfo.badge}">${scoreInfo.label}</span></h5>
            <div class="progress mt-2" style="height: 25px;">
                <div class="progress-bar bg-${scoreInfo.badge}" role="progressbar" style="width: ${player.score}%">${player.score}%</div>
            </div>
            </div>
            <div class="col-md-8">
            <h6>Score Explanation</h6>
            <ul class="list-unstyled">
                ${explanation.length > 0 ? explanation.map(e => `<li><i class="bi bi-dash-circle text-danger me-1"></i> <strong>-${e.value.toFixed(1)} points:</strong> ${e.reason}</li>`).join('') : '<li class="text-muted">No deductions</li>'}
            </ul>
            ${player.scoreBreakdown ? `
                <div class="mt-3">
                    <small class="text-muted">
                        <strong>Total Penalty:</strong> ${player.scoreBreakdown.totalPenalty.toFixed(1)} points<br>
                        <strong>Recent Boost:</strong> ${player.scoreBreakdown.recentBoostMultiplier}x
                    </small>
                </div>
            ` : ''}
            </div>
        </div>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header"><h5>Missed Time / Availability &amp; Medical Flags</h5></div>
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

        <h6 class="mt-3">Medical Flags</h6>
        <div>
            ${player.facts.flags?.cartilageDegeneration ? '<span class="badge bg-danger me-1">Cartilage Degeneration</span>' : ''}
            ${player.facts.flags?.looseBodies ? '<span class="badge bg-danger me-1">Loose Bodies</span>' : ''}
            ${player.facts.flags?.osteoarthritisOrArthrosis ? '<span class="badge bg-danger me-1">Osteoarthritis</span>' : ''}
            ${player.facts.flags?.recurrentInstability ? '<span class="badge bg-warning me-1">Recurrent Instability</span>' : ''}
            ${player.facts.flags?.stressFractureHistory ? '<span class="badge bg-warning me-1">Stress Fracture History</span>' : ''}
            ${player.facts.summaryCounts?.recurrenceTotal > 0 ? `<span class="badge bg-warning text-dark me-1">${player.facts.summaryCounts.recurrenceTotal} Recurrences</span>` : ''}
            ${!player.facts.flags?.cartilageDegeneration && !player.facts.flags?.looseBodies && !player.facts.flags?.osteoarthritisOrArthrosis && !player.facts.flags?.recurrentInstability ? '<span class="badge bg-success">No Major Flags</span>' : ''}
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
                const statusColor = inj.currentStatus === 'Recovered' || inj.currentStatus === 'Asymptomatic' ? 'success' : 
                                   inj.currentStatus === 'Symptomatic' || inj.currentStatus === 'Ongoing' ? 'danger' : 'warning';
                const typeColor = inj.type === 'Fracture' || inj.type === 'Dislocation' || inj.type === 'Tear' ? 'danger' : 
                                 inj.type === 'Sprain' || inj.type === 'Strain' ? 'warning' : 'success';
                return `
                <tr class="injury-row-${playerId}-${i}" style="cursor: pointer; border-bottom: 1px solid #dee2e6;" onclick="toggleInjuryDetails(${playerId}, ${i})">
                    <td>${inj.injuryName || 'Unknown'}</td>
                    <td>${inj.bodyRegion || 'Unknown'} ${inj.side !== 'NA' ? `(${inj.side})` : ''}</td>
                    <td>${formatDate(inj.date)}</td>
                    <td>
                        <!-- Change 1: Display "Severe" for Major and "Mild" for Minor in the injury table -->
                        <span class="badge bg-${inj.severity === 'Major' ? 'danger' : inj.severity === 'Moderate' ? 'warning' : 'secondary'}">
                            ${inj.severity === 'Major' ? 'Severe' : inj.severity === 'Minor' ? 'Mild' : (inj.severity || 'Unknown')}
                        </span>
                    </td>
                    <td>
                        <span class="badge bg-${statusColor}">
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
                const typeColor = surg.procedureCategory === 'Reconstruction' || surg.procedureCategory === 'ORIF' ? 'danger' : 
                                 surg.procedureCategory === 'Repair' ? 'warning' : 'success';
                const outcomeColor = surg.outcome?.residualSymptoms === 'None' ? 'success' : 
                                    surg.outcome?.residualSymptoms === 'Severe' || surg.outcome?.residualSymptoms === 'Moderate' ? 'danger' : 'warning';
                return `
                <tr class="surgery-row-${playerId}-${i}" style="cursor: pointer; border-bottom: 1px solid #dee2e6;" onclick="toggleSurgeryDetails(${playerId}, ${i})">
                    <td>${surg.procedure || 'Unknown'}</td>
                    <td>${surg.bodyRegion || 'Unknown'} ${surg.side !== 'NA' ? `(${surg.side})` : ''}</td>
                    <td>${formatDate(surg.date)}</td>
                    <td>
                        <span class="badge bg-${typeColor}">
                            ${surg.procedureCategory || 'Unknown'}
                        </span>
                    </td>
                    <td>
                        <span class="badge bg-${outcomeColor}">
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

        <h6 class="mt-3">Imaging Findings</h6>
        <table class="table table-sm">
            <thead><tr>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'imaging', 'modality')" style="cursor: pointer;">
                    Modality ${player.sortState.imaging.column === 'modality' ? (player.sortState.imaging.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'imaging', 'bodyRegion')" style="cursor: pointer;">
                    Body Region ${player.sortState.imaging.column === 'bodyRegion' ? (player.sortState.imaging.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th class="sortable-header" onclick="sortPlayerTable(${playerId}, 'imaging', 'date')" style="cursor: pointer;">
                    Date ${player.sortState.imaging.column === 'date' ? (player.sortState.imaging.direction === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th>Structured Findings</th>
                <th style="width: 40px;"></th>
            </tr></thead>
            <tbody>
            ${sortedImaging.map((img, i) => {
                const sf = img.structuredFindings || {};
                const findings = [];
                if (sf.degenerativeChange && sf.degenerativeChange !== 'None' && sf.degenerativeChange !== 'Unknown') findings.push('Degenerative');
                if (sf.cartilageDamage && sf.cartilageDamage !== 'None' && sf.cartilageDamage !== 'Unknown') findings.push('Cartilage');
                if (sf.labrumMeniscusStatus && sf.labrumMeniscusStatus !== 'Normal' && sf.labrumMeniscusStatus !== 'Unknown') findings.push('Labrum/Meniscus');
                if (sf.tendonStatus && sf.tendonStatus !== 'Normal' && sf.tendonStatus !== 'Unknown') findings.push('Tendon');
                if (sf.ligamentStatus && sf.ligamentStatus !== 'Normal' && sf.ligamentStatus !== 'Unknown') findings.push('Ligament');
                if (sf.effusion && sf.effusion !== 'None' && sf.effusion !== 'Unknown') findings.push('Effusion');
                if (sf.looseBodies) findings.push('Loose Bodies');
                if (sf.nonunionOrDelayedUnion) findings.push('Nonunion');
                if (sf.avascularNecrosisConcern) findings.push('AVN');
                if (sf.postTraumaticArthritis) findings.push('Arthritis');
                if (sf.stressReactionOrFracture) findings.push('Stress Fx');
                if (sf.hardwareComplication && sf.hardwareComplication !== 'None' && sf.hardwareComplication !== 'Unknown') findings.push('Hardware');
                const findingsText = findings.length > 0 ? findings.join(', ') : 'None';
                return `
                <tr class="imaging-row-${playerId}-${i}" style="cursor: pointer; border-bottom: 1px solid #dee2e6;" onclick="toggleImagingDetails(${playerId}, ${i})">
                    <td>${img.modality || 'Unknown'}</td>
                    <td>${img.bodyRegion || 'Unknown'} ${img.side !== 'NA' ? `(${img.side})` : ''}</td>
                    <td>${formatDate(img.date)}</td>
                    <td><small>${findingsText}</small></td>
                    <td class="text-center">
                        <i class="bi bi-chevron-down imaging-chevron-${playerId}-${i}" style="font-size: 0.85rem;"></i>
                    </td>
                </tr>
                <tr class="imaging-details-${playerId}-${i}" style="display: none; background-color: #f8f9fa;">
                    <td colspan="5" class="p-3">
                        <div class="row">
                            <div class="col-md-12">
                                <p class="mb-2"><strong>Source:</strong> ${img.sourceDoc || 'Unknown'}</p>
                                ${img.imaging?.finding ? `
                                    <div class="alert alert-info mb-3">
                                        <strong><i class="bi bi-file-medical me-1"></i>Finding Description:</strong><br>
                                        ${img.imaging.finding}
                                    </div>
                                ` : ''}
                                ${img.structuredFindings ? `
                                    <h6 class="text-primary mt-3"><i class="bi bi-clipboard-data me-1"></i>Structured Findings</h6>
                                    <div class="ms-3">
                                        ${img.structuredFindings.degenerativeChange && img.structuredFindings.degenerativeChange !== 'None' && img.structuredFindings.degenerativeChange !== 'Unknown' ? `• Degenerative Change: <span class="badge bg-warning">${img.structuredFindings.degenerativeChange}</span><br>` : ''}
                                        ${img.structuredFindings.cartilageDamage && img.structuredFindings.cartilageDamage !== 'None' && img.structuredFindings.cartilageDamage !== 'Unknown' ? `• Cartilage Damage: <span class="badge bg-warning">${img.structuredFindings.cartilageDamage}</span><br>` : ''}
                                        ${img.structuredFindings.labrumMeniscusStatus && img.structuredFindings.labrumMeniscusStatus !== 'Normal' && img.structuredFindings.labrumMeniscusStatus !== 'Unknown' ? `• Labrum/Meniscus: <span class="badge bg-warning">${img.structuredFindings.labrumMeniscusStatus}</span><br>` : ''}
                                        ${img.structuredFindings.tendonStatus && img.structuredFindings.tendonStatus !== 'Normal' && img.structuredFindings.tendonStatus !== 'Unknown' ? `• Tendon: <span class="badge bg-warning">${img.structuredFindings.tendonStatus}</span><br>` : ''}
                                        ${img.structuredFindings.ligamentStatus && img.structuredFindings.ligamentStatus !== 'Normal' && img.structuredFindings.ligamentStatus !== 'Unknown' ? `• Ligament: <span class="badge bg-warning">${img.structuredFindings.ligamentStatus}</span><br>` : ''}
                                        ${img.structuredFindings.effusion && img.structuredFindings.effusion !== 'None' && img.structuredFindings.effusion !== 'Unknown' ? `• Effusion: <span class="badge bg-success">${img.structuredFindings.effusion}</span><br>` : ''}
                                        ${img.structuredFindings.looseBodies ? `• <span class="badge bg-danger">Loose Bodies Present</span><br>` : ''}
                                        ${img.structuredFindings.nonunionOrDelayedUnion ? `• <span class="badge bg-danger">Nonunion/Delayed Union</span><br>` : ''}
                                        ${img.structuredFindings.avascularNecrosisConcern ? `• <span class="badge bg-danger">AVN Concern</span><br>` : ''}
                                        ${img.structuredFindings.postTraumaticArthritis ? `• <span class="badge bg-danger">Post-Traumatic Arthritis</span><br>` : ''}
                                        ${img.structuredFindings.stressReactionOrFracture ? `• <span class="badge bg-danger">Stress Reaction/Fracture</span><br>` : ''}
                                        ${img.structuredFindings.hardwareComplication && img.structuredFindings.hardwareComplication !== 'None' && img.structuredFindings.hardwareComplication !== 'Unknown' ? `• Hardware: <span class="badge bg-warning">${img.structuredFindings.hardwareComplication}</span><br>` : ''}
                                    </div>
                                ` : ''}
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

                    timelineEvents.push({
                        date: inj.date,
                        type: 'injury',
                        icon: 'bi-bandaid-fill',
                        color: inj.severity === 'Major' ? 'danger' : inj.severity === 'Moderate' ? 'warning' : 'secondary',
                        title: inj.injuryName || 'Injury',
                        meta: `${inj.bodyRegion || 'Unknown'}${inj.side && inj.side !== 'NA' ? ` (${inj.side})` : ''} · ${inj.severity || 'Unknown'} ${inj.type || ''} · ${inj.mechanism || 'Unknown mechanism'}`,
                        clinicalSummary: clinicalSummary || null,
                        timeLoss: timeLossParts.length > 0 ? timeLossParts.join(', ') : null,
                        status: inj.currentStatus || null,
                        statusColor: inj.currentStatus === 'Recovered' || inj.currentStatus === 'Asymptomatic' ? 'success' :
                                     inj.currentStatus === 'Symptomatic' || inj.currentStatus === 'Ongoing' ? 'danger' : 'secondary',
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

                    const outcomeColor = surg.outcome?.residualSymptoms === 'None' ? 'success' :
                                        surg.outcome?.residualSymptoms === 'Severe' || surg.outcome?.residualSymptoms === 'Moderate' ? 'danger' : 'warning';
                    timelineEvents.push({
                        date: surg.date,
                        type: 'surgery',
                        icon: 'bi-scissors',
                        color: 'primary',
                        title: surg.procedure || 'Surgery',
                        meta: `${surg.bodyRegion || 'Unknown'}${surg.side && surg.side !== 'NA' ? ` (${surg.side})` : ''} · ${surg.procedureCategory || 'Unknown'}${surg.revision ? ' · Revision' : ''}`,
                        clinicalSummary: surgClinicalSummary || null,
                        timeLoss: null,
                        outcome: surg.outcome?.residualSymptoms || null,
                        outcomeColor,
                    });
                }
            });

            // Sort by date (most recent first)
            timelineEvents.sort((a, b) => new Date(b.date) - new Date(a.date));

            if (timelineEvents.length === 0) {
                return '<p class="text-muted">No timeline data available</p>';
            }

            return `
                <div class="timeline">
                    ${timelineEvents.map(event => `
                        <div class="timeline-item mb-3 pb-3 border-bottom">
                            <div class="d-flex align-items-start">
                                <div class="me-3 pt-1">
                                    <i class="bi ${event.icon} text-${event.color} fs-4"></i>
                                </div>
                                <div class="flex-grow-1">
                                    <div class="d-flex align-items-center flex-wrap gap-2 mb-1">
                                        <span class="badge bg-${event.color}">${event.type.toUpperCase()}</span>
                                        <strong>${event.title}</strong>
                                        <span class="text-muted small">${formatDate(event.date)}</span>
                                    </div>
                                    <div class="text-muted small mb-1">${event.meta}</div>
                                    ${event.clinicalSummary ? `<p class="mb-1 small">${event.clinicalSummary}</p>` : ''}
                                    <div class="d-flex flex-wrap gap-2 mt-1">
                                        ${event.timeLoss ? `<span class="badge bg-danger bg-opacity-10 text-danger border border-danger-subtle"><i class="bi bi-clock me-1"></i>Time lost: ${event.timeLoss}</span>` : ''}
                                        ${event.status ? `<span class="badge bg-${event.statusColor || 'secondary'} bg-opacity-10 text-${event.statusColor || 'secondary'} border border-${event.statusColor || 'secondary'}-subtle">${event.status}</span>` : ''}
                                        ${event.outcome ? `<span class="badge bg-${event.outcomeColor || 'secondary'} bg-opacity-10 text-${event.outcomeColor || 'secondary'} border border-${event.outcomeColor || 'secondary'}-subtle">Residual: ${event.outcome}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        })()}
        </div>
    </div>

    ${(() => {
        const imgs = player.facts.imagingFindings || [];
        if (imgs.length === 0) return '';

        // Determine date range of imaging
        const imgDates = imgs.map(i => i.date).filter(Boolean).sort();
        const dateRangeText = imgDates.length > 1
            ? `between ${formatDate(imgDates[0])} and ${formatDate(imgDates[imgDates.length - 1])}`
            : imgDates.length === 1 ? `on ${formatDate(imgDates[0])}` : '';

        // Group by bodyRegion + side
        const groups = new Map();
        imgs.forEach(img => {
            const key = `${img.bodyRegion || 'Other'}|${img.side && img.side !== 'NA' ? img.side : ''}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(img);
        });

        const renderStructuredFindings = (sf) => {
            if (!sf) return '';
            const lines = [];
            if (sf.degenerativeChange && sf.degenerativeChange !== 'None' && sf.degenerativeChange !== 'Unknown') lines.push(`<strong>Degenerative Change:</strong> ${sf.degenerativeChange}`);
            if (sf.cartilageDamage && sf.cartilageDamage !== 'None' && sf.cartilageDamage !== 'Unknown') lines.push(`<strong>Cartilage Damage:</strong> ${sf.cartilageDamage}`);
            if (sf.labrumMeniscusStatus && sf.labrumMeniscusStatus !== 'Normal' && sf.labrumMeniscusStatus !== 'Unknown') lines.push(`<strong>Labrum/Meniscus:</strong> ${sf.labrumMeniscusStatus}`);
            if (sf.tendonStatus && sf.tendonStatus !== 'Normal' && sf.tendonStatus !== 'Unknown') lines.push(`<strong>Tendon:</strong> ${sf.tendonStatus}`);
            if (sf.ligamentStatus && sf.ligamentStatus !== 'Normal' && sf.ligamentStatus !== 'Unknown') lines.push(`<strong>Ligament:</strong> ${sf.ligamentStatus}`);
            if (sf.effusion && sf.effusion !== 'None' && sf.effusion !== 'Unknown') lines.push(`<strong>Effusion:</strong> ${sf.effusion}`);
            if (sf.looseBodies) lines.push(`<strong>Loose Bodies:</strong> Present`);
            if (sf.nonunionOrDelayedUnion) lines.push(`<strong>Nonunion / Delayed Union:</strong> Present`);
            if (sf.avascularNecrosisConcern) lines.push(`<strong>AVN Concern:</strong> Present`);
            if (sf.postTraumaticArthritis) lines.push(`<strong>Post-Traumatic Arthritis:</strong> Present`);
            if (sf.stressReactionOrFracture) lines.push(`<strong>Stress Reaction / Fracture:</strong> Present`);
            if (sf.hardwareComplication && sf.hardwareComplication !== 'None' && sf.hardwareComplication !== 'Unknown') lines.push(`<strong>Hardware Complication:</strong> ${sf.hardwareComplication}`);
            return lines.length ? `<ul class="mb-0 ps-3">${lines.map(l => `<li class="small">${l}</li>`).join('')}</ul>` : '';
        };

        const groupHtml = [...groups.entries()].map(([key, entries]) => {
            const [region, side] = key.split('|');
            const regionLabel = side ? `${region} (${side})` : region;
            const modalities = [...new Set(entries.map(e => e.modality).filter(Boolean))].join(', ');
            const latestEntry = entries.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
            const impression = latestEntry.imaging?.finding || null;
            const structuredHtml = renderStructuredFindings(latestEntry.structuredFindings);

            return `
                <div class="mb-4">
                    <h6 class="fw-bold border-bottom pb-1 mb-2">
                        <i class="bi bi-file-medical me-1 text-primary"></i>${regionLabel}
                        <span class="text-muted fw-normal small ms-2">${modalities} · ${formatDate(latestEntry.date)}</span>
                    </h6>
                    ${impression ? `
                        <p class="mb-1"><strong>Impression:</strong> ${impression}</p>
                    ` : ''}
                    ${structuredHtml ? `
                        <p class="mb-1 mt-2"><strong>Findings:</strong></p>
                        ${structuredHtml}
                    ` : ''}
                    ${entries.length > 1 ? `
                        <details class="mt-2">
                            <summary class="text-muted small" style="cursor:pointer;">Show ${entries.length - 1} additional study/studies</summary>
                            ${entries.slice(1).map(e => `
                                <div class="mt-2 ps-2 border-start border-2">
                                    <p class="mb-1 small text-muted">${e.modality || ''} · ${formatDate(e.date)}</p>
                                    ${e.imaging?.finding ? `<p class="mb-1 small"><strong>Impression:</strong> ${e.imaging.finding}</p>` : ''}
                                    ${renderStructuredFindings(e.structuredFindings)}
                                </div>
                            `).join('')}
                        </details>
                    ` : ''}
                </div>
            `;
        }).join('');

        return `
    <div class="card mb-3" id="radiology-card-${playerId}">
        <div class="card-header"><h5><i class="bi bi-radioactive me-2 text-primary"></i>Radiology Findings &amp; Impressions</h5></div>
        <div class="card-body">
            <p class="text-muted mb-3">The following imaging studies were conducted ${dateRangeText} for <strong>${player.name}</strong>.</p>
            ${groupHtml}
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