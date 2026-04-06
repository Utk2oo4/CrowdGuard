/* ================================================================
   chatbot.js — AI Assistant Integration for CrowdGuard System
   ================================================================ */

// DOM Elements
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// State
let chatHistory = [];
// Clear any old history from local storage so it starts fresh each refresh
localStorage.removeItem('cg-chat-history');

// Load snapshot DataURLs passed from the simulation page (consumed once)
let pendingSnapshots = {};
try {
  const raw = localStorage.getItem('cg-pending-snapshots');
  if (raw) {
    pendingSnapshots = JSON.parse(raw);
    localStorage.removeItem('cg-pending-snapshots'); // consume once
  }
} catch (e) { pendingSnapshots = {}; }

function saveHistory() {
  localStorage.setItem('cg-chat-history', JSON.stringify(chatHistory));
}

window.clearChatHistory = function () {
  if (confirm("Are you sure you want to clear the chat history?")) {
    chatHistory = [];
    saveHistory();
    chatMessages.innerHTML = '';
    renderGreeting();
  }
}

// ── Suggestion & Mode Logic ────────────────────────────────────
window.suggestQuery = function(text) {
  chatInput.value = text;
  chatForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
};

window.setChatMode = function(mode) {
  const modeInput = document.getElementById('mode-select');
  const ragBtn = document.getElementById('btn-mode-rag');
  const normalBtn = document.getElementById('btn-mode-normal');
  
  if (!modeInput || !ragBtn || !normalBtn) return;

  modeInput.value = mode;

  // Visual state
  if (mode === 'rag') {
    ragBtn.style.background = 'var(--accent)';
    ragBtn.style.color = '#fff';
    normalBtn.style.background = 'transparent';
    normalBtn.style.color = 'var(--dim)';
  } else {
    normalBtn.style.background = 'var(--accent)';
    normalBtn.style.color = '#fff';
    ragBtn.style.background = 'transparent';
    ragBtn.style.color = 'var(--dim)';
  }
};

// Default styles for mode buttons on load
setTimeout(() => {
  setChatMode('normal');
}, 100);

const baseSystemContext = `You are the CrowdGuard AI Assistant, an expert in evacuation modeling, facility planning, and crowd dynamics. 
You help event managers evaluate crowd safety based on simulation reports.

### RESPONSE STYLE GUIDELINES:
1. **CLARITY**: Use short, punchy paragraphs (maximum 3 sentences).
2. **STRUCTURE**: Use bullet points for any lists or multiple recommendations.
3. **EMPHASIS**: Bold key metrics and safety instructions for quick scanning.
4. **SPACING**: Ensure a clear visual break between different sections of your analysis.
5. **DE-CLUTTER**: Avoid unnecessary filler words; provide direct, high-value safety insights.

When the user pastes simulation metrics:
1. Analyze the evacuation rate and peak density.
2. Explain the EVENT TIMELINE impacts on safety.
3. Provide actionable layout recommendations if bottlenecks occur.`;

// ----------------------------------------------------------------
// 1. Initial State
// ----------------------------------------------------------------
// Enable input immediately since we aren't waiting for a file
chatInput.disabled = false;
sendBtn.disabled = false;

// ----------------------------------------------------------------
// 2. Chat Interface Helpers
// ----------------------------------------------------------------
function addBotMessage(markdownText, addPdfButton = false) {
  const row = document.createElement('div');
  row.className = 'msg-row bot';
  row.innerHTML = `<div class="msg-bubble">${marked.parse(markdownText)}</div>`;
  chatMessages.appendChild(row);

  if (addPdfButton) {
    const btn = document.createElement('button');
    btn.className = 'pdf-download-btn';
    btn.title = 'Download a PDF with the AI analysis and map snapshots';
    btn.style.cssText = `
      display:inline-flex; align-items:center; gap:8px;
      margin: 8px 0 4px 0;
      padding: 9px 20px;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      color: #fff;
      border: none; border-radius: 10px;
      font-family: 'Syne', sans-serif; font-weight: 700; font-size: 0.82rem;
      cursor: pointer; letter-spacing: 0.4px;
      box-shadow: 0 3px 14px rgba(99,102,241,0.4);
      transition: transform 0.15s, box-shadow 0.15s;
    `;
    btn.innerHTML = '⬇ Download PDF Report';
    btn.onmouseenter = () => { btn.style.transform='translateY(-1px)'; btn.style.boxShadow='0 5px 18px rgba(99,102,241,0.55)'; };
    btn.onmouseleave = () => { btn.style.transform=''; btn.style.boxShadow='0 3px 14px rgba(99,102,241,0.4)'; };
    btn.addEventListener('click', (e) => generatePDF(markdownText, e.currentTarget));
    // Insert after the bubble, inside the same row
    row.appendChild(btn);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ----------------------------------------------------------------
// PDF Generation
// ----------------------------------------------------------------
async function generatePDF(botReply, btnElement = null) {
  const btn = btnElement || document.getElementById('pdf-download-btn');
  if (btn) { btn.textContent = '⏳ Generating PDF...'; btn.disabled = true; }

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentW = pageW - margin * 2;
    let y = margin;

    // ── Header ───────────────────────────────────────────────────
    doc.setFillColor(30, 33, 48);
    doc.rect(0, 0, pageW, 28, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text('CrowdGuard AI Safety Report', margin, 13);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 160, 190);
    const dateStr = new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });
    doc.text(`Generated: ${dateStr}`, margin, 21);
    y = 36;

    // ── Section title: AI Analysis ───────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(59, 130, 246);
    doc.text('AI Analysis', margin, y);
    y += 5;
    doc.setDrawColor(59, 130, 246);
    doc.setLineWidth(0.4);
    doc.line(margin, y, pageW - margin, y);
    y += 6;

    // ── Strip markdown for plain-text in PDF ─────────────────────
    const plainText = botReply
      .replace(/#{1,6}\s*/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
      .replace(/^[-*+]\s+/gm, '• ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 55);

    const lines = doc.splitTextToSize(plainText, contentW);
    const lineH = 5;

    for (const line of lines) {
      if (y + lineH > pageH - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += lineH;
    }
    y += 6;

    // ── Snapshots section ─────────────────────────────────────────
    const snapLabels = {
      heat:   'Density Heatmap',
      vel:    'Velocity Vectors',
      trail:  'Movement Trails',
      danger: 'Danger Zones',
    };
    const snapOrder = ['heat', 'vel', 'trail', 'danger'];
    const availableSnaps = snapOrder.filter(k => pendingSnapshots[k]);

    if (availableSnaps.length > 0) {
      if (y + 20 > pageH - margin) { doc.addPage(); y = margin; }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(59, 130, 246);
      doc.text('Map View Snapshots', margin, y);
      y += 5;
      doc.setDrawColor(59, 130, 246);
      doc.setLineWidth(0.4);
      doc.line(margin, y, pageW - margin, y);
      y += 8;

      for (const key of availableSnaps) {
        const imgData = pendingSnapshots[key];
        // Fit image to content width, maintain aspect ratio (canvas is typically square)
        const imgW = contentW;
        const imgH = contentW * 0.6; // approximate 5:3 ratio for map canvas

        if (y + imgH + 14 > pageH - margin) { doc.addPage(); y = margin; }

        // Image label
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 80);
        doc.text(snapLabels[key], margin, y);
        y += 4;

        // Draw a subtle border rect
        doc.setDrawColor(200, 205, 220);
        doc.setLineWidth(0.3);
        doc.rect(margin, y, imgW, imgH);

        doc.addImage(imgData, 'PNG', margin, y, imgW, imgH);
        y += imgH + 3;

        // Caption below image
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(120, 130, 150);
        doc.text(`Fig: ${snapLabels[key]} — captured post-evacuation`, margin, y);
        y += 10;
      }
    }

    // ── Footer on every page ──────────────────────────────────────
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(160, 170, 190);
      doc.text(`CrowdGuard AI Safety Report  •  Page ${p} of ${totalPages}`, margin, pageH - 6);
      doc.text(`Confidential — Generated by CrowdGuard System`, pageW - margin, pageH - 6, { align: 'right' });
    }

    const fileName = `CrowdGuard_Report_${Date.now()}.pdf`;
    doc.save(fileName);
  } catch (err) {
    console.error('PDF generation failed:', err);
    alert('PDF generation failed: ' + err.message);
  } finally {
    if (btn) { btn.textContent = '⬇ Download PDF Report'; btn.disabled = false; }
  }
}

function addUserMessage(text) {
  const row = document.createElement('div');
  row.className = 'msg-row user';
  // Escape HTML manually for the user text
  const safeText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Wrap in a pre-wrap div so pasted data maintains line breaks
  row.innerHTML = `<div class="msg-bubble" style="white-space: pre-wrap;">${safeText}</div>`;
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderGreeting() {
  const row = document.createElement('div');
  row.className = 'msg-row bot';
  row.innerHTML = `<div class="msg-bubble"><b>Hello!</b> I am your CrowdGuard AI Assistant.<br>How can I help you analyze your evacuation data today? You can copy and paste simulation metrics directly here.</div>`;
  chatMessages.appendChild(row);
}

// Show a loading indicator while fetching
function showTypingIndicator() {
  const row = document.createElement('div');
  row.className = 'msg-row bot typing-indicator';
  row.innerHTML = `<div class="msg-bubble" style="font-family:monospace; color:var(--dim)">Thinking...</div>`;
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
function removeTypingIndicator() {
  const el = document.querySelector('.typing-indicator');
  if (el) el.remove();
}

// Initialize chat interface based on history
chatMessages.innerHTML = '';
if (chatHistory.length === 0) {
  renderGreeting();
} else {
  chatHistory.forEach(msg => {
    if (msg.role === 'user') {
      addUserMessage(msg.content);
    } else if (msg.role === 'assistant') {
      addBotMessage(msg.content, true); // true = attach PDF download button
    }
  });
}

// ── Auto-load pending timeline from simulation ────────────────
(function loadPendingTimeline() {
  const pending = localStorage.getItem('cg-pending-timeline');
  if (!pending) return;
  localStorage.removeItem('cg-pending-timeline'); // consume it once

  // Small delay to let the DOM settle, then pre-fill & submit
  setTimeout(() => {
    chatInput.value = pending;
    chatForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, 400);
})();


// ----------------------------------------------------------------
// 3. API Integration (Qdrant + Groq)
// ----------------------------------------------------------------
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  // Update UI immediately
  addUserMessage(text);
  chatHistory.push({ role: "user", content: text });
  saveHistory();
  
  chatInput.value = '';
  chatInput.disabled = true;
  sendBtn.disabled = true;
  showTypingIndicator();

  // 1. Prepare Request to FastAPI Backend
  const modeSelect = document.getElementById('mode-select');
  const selectedMode = modeSelect ? modeSelect.value : 'rag';

  try {
    const response = await fetch("http://localhost:8000/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question: text,
        mode: selectedMode,
        history: chatHistory, // Added conversation history
        k: 3
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "API request failed");
    }

    const data = await response.json();
    const botReply = data.answer;

    // Add to history and UI
    chatHistory.push({ role: "assistant", content: botReply });
    saveHistory();
    removeTypingIndicator();
    addBotMessage(botReply, true); // true = attach PDF download button

  } catch (err) {
    console.error(err);
    removeTypingIndicator();
    addBotMessage(`⚠️ **Error communicating with the RAG System:** ${err.message}`);
    chatHistory.pop();
    saveHistory();
  } finally {
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
});
