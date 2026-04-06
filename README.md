# 🛡️ CrowdGuard: Integrated RAG AI & Simulation

Welcome to the **CrowdGuard System**! This professional evacuation modeling and AI assistant package is ready to run and share.

---

## 🚀 Quick Start (Using `uv`)

Follow these simple steps to get the full system (Simulation + AI Chatbot) running on your machine:

### **Step 1: Install `uv` (If you haven't)**
- **Windows:** 
  ```powershell
  powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
  ```
- **macOS/Linux:**
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

### **Step 2: Setup your API Key**
1. Locate the file **`.env.example`** in the root directory.
2. **Rename** it to simply **`.env`**.
3. Open it and paste your **Groq API Key** where it says `PASTE_YOUR_GROQ_KEY_HERE`.

### **Step 3: Start the Backend Server**
Open your terminal in this folder and run:
```powershell
uv run python main.py
```
This command will **automatically** create your environment and start the API engine. Wait until you see:
`✅ System Ready!`

### **Step 4: Launch the Interface**
Open your web browser (Chrome or Edge recommended) and go to:
👉 **`http://localhost:8000/frontend/index.html`**

---

## 🧠 Using the AI Chatbot ("Side Chick")

- **Where is it?** Once you are in the simulation (`index.html`), look for the **"AI Assistant"** tab or icon.
- **Normal Mode:** Best for general crowd safety questions.
- **RAG Mode:** This is the high-visibility "Specialist" mode. In this mode, the AI reads the **PDFs in the `data/` folder** to give you expert advice grounded in document evidence.
- **Memory:** The AI remembers your conversation! You can ask follow-up questions about simulation metrics you've pasted earlier in the session.

---

## 🔧 Maintenance & Repair

### **If you add new PDFs:**
If you want the AI to learn from new documents, add your PDFs to `data/pdf/` and run:
```powershell
uv run python reindex.py
```
This will rebuild the local database (`chroma_db`) with your new information.

---

## 📦 Requirements for Sharing
When zipping this project for others:
- **INCLUDE:** `main.py`, `reindex.py`, `chroma_db/`, `CROWD_GUARD/`, `data/`, `pyproject.toml`, `uv.lock`, `.env.example`.
- **EXCLUDE:** `.venv/` (others will build their own) and your secret `.env` file.

**Stay Safe!** 🛡️🚀
