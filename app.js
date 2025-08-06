import * as pdfjsLib from './pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';

const inputText = document.getElementById('inputText');
const pdfInput = document.getElementById('pdfInput');
const mediaInput = document.getElementById('mediaInput');
const transcribeBtn = document.getElementById('transcribeBtn');
const readingLevel = document.getElementById('readingLevel');
const apiKeyInput = document.getElementById('apiKey');
const openaiApiKeyInput = document.getElementById('openaiApiKey');
const summarizerForm = document.getElementById('summarizerForm');
const loadingSpinner = document.getElementById('loadingSpinner');
const statusToast = document.getElementById('statusToast');
const outputSection = document.getElementById('outputSection');
const summaryList = document.getElementById('summaryList');
const flashcardsContainer = document.getElementById('flashcardsContainer');
const downloadTxtBtn = document.getElementById('downloadTxtBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const saveLocalBtn = document.getElementById('saveLocalBtn');
const darkToggle = document.getElementById('darkToggle');

function showToast(msg, duration=2300) {
  statusToast.textContent = msg;
  statusToast.classList.remove('show');
  setTimeout(() => {
    statusToast.classList.add('show');
    setTimeout(() => statusToast.classList.remove('show'), duration);
  }, 10);
}

function setLoading(loading) {
  loadingSpinner.style.display = loading ? 'block' : 'none';
}

darkToggle && darkToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', document.body.classList.contains('dark-mode') ? '1' : '0');
});

if(localStorage.getItem('darkMode') === '1') {
  document.body.classList.add('dark-mode');
}

// ==== PDF.js Integration ====
// Extract text from PDF, autofill textarea, and auto-summarize if Gemini API key is provided
pdfInput.addEventListener('change', async (e) => {
  const file = pdfInput.files[0];
  if (!file) return;
  showToast('Extracting text from PDF...');
  setLoading(true);
  const reader = new FileReader();
  reader.onload = async function() {
    try {
      const pdf = await pdfjsLib.getDocument({data: reader.result}).promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(' ') + '\n';
      }
      inputText.value = fullText.trim();
      showToast('PDF text extracted!');
      const apiKey = apiKeyInput.value.trim();
      const level = readingLevel.value;
      if (apiKey && fullText.trim()) {
        showToast('Summarizing PDF content using Gemini...');
        try {
          const responseText = await callGeminiAPI(fullText.trim(), level, apiKey);
          const parsed = parseGeminiOutput(responseText);
          renderOutput(parsed);
          try {
            localStorage.setItem('lastSummary', JSON.stringify(parsed));
          } catch (err) {
            showToast('LocalStorage full or blocked.');
          }
          showToast('PDF summarized!');
        } catch (err) {
          showToast('Error: ' + (err.message || 'Failed to summarize PDF using Gemini.'));
        }
      }
    } catch (err) {
      showToast('PDF extraction failed.');
    }
    setLoading(false);
    pdfInput.value = '';
  };
  reader.readAsArrayBuffer(file);
});

// ==== Audio/Video Transcription with OpenAI Whisper ====
transcribeBtn.addEventListener('click', async () => {
  const file = mediaInput.files[0];
  const openaiKey = openaiApiKeyInput ? openaiApiKeyInput.value.trim() : '';
  if (!file) {
    showToast('Please select an audio or video file.');
    return;
  }
  if (!openaiKey) {
    showToast('Please enter your OpenAI API key for transcription.');
    return;
  }
  showToast('Uploading file for transcription...');
  setLoading(true);

  try {
    // Prepare form data for Whisper API
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'text');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Transcription failed (${response.status})`);
    }
    const transcription = await response.text();
    inputText.value = transcription.trim();
    showToast('Transcription complete!');
  } catch (err) {
    showToast('Error: ' + (err.message || 'Failed to transcribe.'));
  } finally {
    setLoading(false);
  }
});

// ==== Gemini API Integration ====
async function callGeminiAPI(content, level, apiKey) {
  const model = "gemini-1.5-flash";
  const prompt = `You are an educational assistant. Summarize the following content at a ${level} reading level into bullet points. Then create 5 flashcards with question-answer pairs to help a student understand the topic better. Content: ${content}`;
  let endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{
      parts: [{text: prompt}]
    }]
  };
  try {
    setLoading(true);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error(`API error (${res.status})`);
    }
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text) || '';
    setLoading(false);
    return text;
  } catch (err) {
    setLoading(false);
    throw err;
  }
}

// ==== Output Parsing ====
function parseGeminiOutput(text) {
  let summary = [];
  let flashcards = [];
  const bulletRegex = /^[\-\*\•]\s+(.+)$/gm;
  let match;
  while ((match = bulletRegex.exec(text)) !== null) {
    summary.push(match[1]);
  }
  const qaRegex = /Q:\s*(.+?)\s*A:\s*(.+?)(?=(Q:|$))/gs;
  let qaMatch;
  while ((qaMatch = qaRegex.exec(text)) !== null) {
    flashcards.push({q: qaMatch[1].trim(), a: qaMatch[2].trim()});
  }
  if (summary.length === 0) {
    summary = text.split(/\n/).slice(0,7).map(l => l.trim()).filter(l => l.length);
  }
  if (flashcards.length === 0) {
    for (let i = 0; i < 5 && i < summary.length; i++) {
      flashcards.push({q: `What does this mean: "${summary[i]}"?`, a: summary[i]});
    }
  }
  return {summary, flashcards};
}

// ==== UI Rendering ====
// Render summary list, flipcard, and flashcards
function renderOutput({summary, flashcards}) {
  outputSection.style.display = 'block';
  summaryList.innerHTML = '';
  flashcardsContainer.innerHTML = '';

  // Presentable summary with icons (handled by CSS)
  summary.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    summaryList.appendChild(li);
  });

  // --- Flipcard for Key Points ---
  if (summary.length > 0) {
    const flipCard = document.createElement('div');
    flipCard.className = 'flipcard';

    const flipInner = document.createElement('div');
    flipInner.className = 'flipcard-inner';

    const flipFront = document.createElement('div');
    flipFront.className = 'flipcard-front';
    const frontHeader = document.createElement('div');
    frontHeader.className = 'flipcard-title';
    frontHeader.textContent = 'Key Points';
    flipFront.appendChild(frontHeader);
    const frontIcon = document.createElement('div');
    frontIcon.innerHTML = "📝";
    frontIcon.style.fontSize = "2rem";
    flipFront.appendChild(frontIcon);

    const flipBack = document.createElement('div');
    flipBack.className = 'flipcard-back';
    const ul = document.createElement('ul');
    ul.className = 'flipcard-points';
    summary.forEach(p => {
      const li = document.createElement('li');
      li.textContent = p;
      ul.appendChild(li);
    });
    flipBack.appendChild(ul);

    flipInner.appendChild(flipFront);
    flipInner.appendChild(flipBack);
    flipCard.appendChild(flipInner);

    flipCard.onclick = function() {
      flipCard.classList.toggle('flipped');
    };

    flashcardsContainer.appendChild(flipCard);
  }

  // Flashcards
  flashcards.forEach((card, idx) => {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'flashcard no-flip';

    const qaContent = document.createElement('div');
    qaContent.className = 'flashcard-content';
    qaContent.innerHTML = `<strong>Q${idx + 1}:</strong> ${card.q}<br><strong>A${idx + 1}:</strong> ${card.a}`;

    cardDiv.appendChild(qaContent);
    flashcardsContainer.appendChild(cardDiv);
  });
}

// ==== Form Submission ====
summarizerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = inputText.value.trim();
  const level = readingLevel.value;
  const apiKey = apiKeyInput.value.trim();
  if (!content) {
    showToast('Please enter or upload some content.');
    return;
  }
  if (!apiKey) {
    showToast('Please enter your Gemini API key.');
    return;
  }
  showToast('Processing with Gemini AI...');
  try {
    const responseText = await callGeminiAPI(content, level, apiKey);
    const parsed = parseGeminiOutput(responseText);
    renderOutput(parsed);
    try {
      localStorage.setItem('lastSummary', JSON.stringify(parsed));
    } catch (err) {
      showToast('LocalStorage full or blocked.');
    }
    showToast('Summary & flashcards generated!');
  } catch (err) {
    showToast('Error: ' + (err.message || 'Failed to fetch from Gemini API.'));
  }
});

// ==== Export Functions ====
downloadTxtBtn.addEventListener('click', () => {
  let txt = 'Summary:\n';
  [...summaryList.children].forEach(li => txt += '- ' + li.textContent + '\n');
  txt += '\nFlashcards:\n';
  [...flashcardsContainer.children].forEach((card, i) => {
    if (card.classList.contains('flipcard')) return;
    const contentEl = card.querySelector('.flashcard-content');
    const content = contentEl ? contentEl.textContent : '';
    txt += `${content}\n\n`;
  });
  const blob = new Blob([txt], {type: 'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'smart-summary.txt';
  a.click();
});

downloadPdfBtn.addEventListener('click', () => {
  showToast('Printing just the summary/flashcards is best done via browser print dialog. Choose "Save as PDF".');
  window.print();
});

saveLocalBtn.addEventListener('click', () => {
  let summary = [];
  let flashcards = [];
  [...summaryList.children].forEach(li => summary.push(li.textContent));
  [...flashcardsContainer.children].forEach(card => {
    if (card.classList.contains('flipcard')) return;
    const contentEl = card.querySelector('.flashcard-content');
    const content = contentEl ? contentEl.textContent : '';
    flashcards.push({q: '', a: content});
  });
  try {
    localStorage.setItem('lastSummary', JSON.stringify({summary, flashcards}));
    showToast('Summary saved locally!');
  } catch (err) {
    showToast('LocalStorage full or blocked.');
  }
});

// ==== Restore Previous Summary (if any) ====
window.addEventListener('DOMContentLoaded', () => {
  const prev = localStorage.getItem('lastSummary');
  if (prev) {
    try {
      const data = JSON.parse(prev);
      renderOutput(data);
    } catch(e){
      outputSection.style.display = 'none';
    }
  } else {
    outputSection.style.display = 'none';
  }
});