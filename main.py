import os
from dotenv import load_dotenv
from typing import List, Optional
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
import chromadb
import numpy as np
from langchain_groq import ChatGroq
from contextlib import asynccontextmanager

# Load environment variables (API Key)
load_dotenv()

# ---- GLOBAL STATE ----
db_client = None
collection = None
embedding_model = None
generator = None

# ---- MODELS ----
class Source(BaseModel):
    source: str
    content_preview: str
    relevance_score: float = 0.0

class ChatMessage(BaseModel):
    role: str
    content: str

class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1)
    k: int = Field(3, ge=1, le=10)
    mode: str = Field("normal", description="Mode: 'rag' or 'normal'")
    history: List[ChatMessage] = Field(default_factory=list)

class QueryResponse(BaseModel):
    question: str
    answer: str
    sources: List[Source]
    mode: str

# ---- CORE LOGIC ----

class EmbeddingManager:
    def __init__(self, model_name="BAAI/bge-small-en"):
        self.model = SentenceTransformer(model_name)

    def embed_query(self, query):
        return self.model.encode([query], normalize_embeddings=True)[0]

class RAGRetriever:
    def __init__(self, collection, embedding_manager):
        self.collection = collection
        self.embedding_manager = embedding_manager

    def retrieve(self, query: str, k: int = 3):
        query_emb = self.embedding_manager.embed_query(query)

        results = self.collection.query(
            query_embeddings=[query_emb.tolist()],
            n_results=k
        )

        sources = []
        if results["documents"]:
            for i in range(len(results["documents"][0])):
                doc_text = results["documents"][0][i]
                metadata = results["metadatas"][0][i] if results["metadatas"] else {}
                # distance is returned, we can convert to a pseudo-similarity if needed
                score = 1.0 - (results["distances"][0][i] if results["distances"] else 0.0)
                
                sources.append(Source(
                    source=metadata.get("source", "Unknown PDF"),
                    content_preview=doc_text,
                    relevance_score=max(0.0, score)
                ))
        
        return sources

class RAGGenerator:
    def __init__(self, model_name="llama-3.3-70b-versatile"):
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY not found")
        
        self.llm = ChatGroq(
            model_name=model_name,
            api_key=api_key,
            temperature=0.1
        )

    def generate(self, query: str, sources: List[Source], mode: str = "rag", history: List[ChatMessage] = None):
        # Format conversation history
        history_text = ""
        if history:
            for msg in history[-15:]:
                history_text += f"{msg.role.upper()}: {msg.content}\n"

        if mode == "rag" and sources:
            context_text = "\n\n---\n\n".join([f"SOURCE: {s.source}\nCONTENT: {s.content_preview}" for s in sources])
            prompt = f"""You are an elite Knowledge Retrieval Assistant. Provide a high-clarity, professional answer based EXCLUSIVELY on the provided context and conversation history.

### STYLE RULES:
- **Short Paragraphs**: Max 3 sentences.
- **Bullet Points**: Use for facts or lists.
- **Bold Key Terms**: For metrics and safety risks.

### CONVERSATION HISTORY (FOR CONTEXT):
{history_text}

### DOCUMENT CONTEXT (PRIMARY TRUTH):
{context_text}

### USER QUESTION:
{query}

### SYNTHESIZED RESPONSE:"""
        else:
            prompt = f"""You are the CrowdGuard AI Assistant, an expert in crowd safety. 
Maintain a professional tone and provide direct, high-value insights.

### CONVERSATION HISTORY:
{history_text}

### USER QUESTION:
{query}

### RESPONSE:"""
        
        response = self.llm.invoke(prompt)
        return response.content

# ---- API SETUP ----

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    global db_client, collection, embedding_model, generator
    print("🚀 Initializing Professional RAG API...")
    
    try:
        embedding_model = EmbeddingManager()
        db_client = chromadb.PersistentClient(path="./chroma_db")
        collection = db_client.get_or_create_collection("pdf_documents")
        generator = RAGGenerator()
        print("✅ System Ready!")
    except Exception as e:
        print(f"❌ Startup Error: {e}")
    
    yield

app = FastAPI(title="Professional RAG API", version="2.5.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/frontend", StaticFiles(directory="CROWD_GUARD"), name="static")

@app.get("/")
async def root():
    return {
        "message": "Professional RAG API is running", 
        "docs": "/docs", 
        "frontend": "/frontend/chatbot.html"
    }

@app.get("/health")
async def health():
    return {"status": "healthy", "vector_store": collection is not None}

@app.post("/query", response_model=QueryResponse)
async def query_rag(request: QueryRequest):
    if not generator:
        raise HTTPException(status_code=503, detail="System not initialized")

    sources = []
    if request.mode == "rag":
        if not collection:
            raise HTTPException(status_code=503, detail="Vector Store not loaded")
        retriever = RAGRetriever(collection, embedding_model)
        sources = retriever.retrieve(request.question, k=request.k)
        
        if not sources:
            return QueryResponse(
                question=request.question,
                answer="No relevant documentation found in the vector store.",
                sources=[],
                mode="rag"
            )

    try:
        answer = generator.generate(request.question, sources, mode=request.mode, history=request.history)
        return QueryResponse(
            question=request.question,
            answer=answer,
            sources=sources,
            mode=request.mode
        )
    except Exception as e:
        raise HTTPException(status_code=512, detail=f"Generation failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)