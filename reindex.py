import os
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
import chromadb

# Settings
PDF_DIR = "./data/pdf"
DB_DIR = "./chroma_db"
MODEL_NAME = "BAAI/bge-small-en"

def reindex():
    print("🚀 Starting Professional Re-Indexing...")
    
    # 1. Initialize Embedding Model
    print(f"🔄 Loading embedding model: {MODEL_NAME}...")
    model = SentenceTransformer(MODEL_NAME)

    # 2. Setup ChromaDB
    print(f"🔄 Setting up fresh ChromaDB at: {DB_DIR}...")
    if os.path.exists(DB_DIR):
        import shutil
        shutil.rmtree(DB_DIR)
    
    client = chromadb.PersistentClient(path=DB_DIR)
    collection = client.create_collection("pdf_documents")

    # 3. Load and Split PDFs
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
    
    pdf_files = [f for f in os.listdir(PDF_DIR) if f.endswith(".pdf")]
    
    for pdf_file in pdf_files:
        print(f"📄 Processing: {pdf_file}...")
        loader = PyPDFLoader(os.path.join(PDF_DIR, pdf_file))
        pages = loader.load()
        chunks = text_splitter.split_documents(pages)
        
        ids = []
        embeddings = []
        metadatas = []
        documents = []
        
        for i, chunk in enumerate(chunks):
            chunk_id = f"{pdf_file}_{i}"
            emb = model.encode(chunk.page_content, normalize_embeddings=True).tolist()
            
            ids.append(chunk_id)
            embeddings.append(emb)
            metadatas.append({"source": pdf_file, "page": chunk.metadata.get("page", 0)})
            documents.append(chunk.page_content)
        
        # Batch add to collection
        collection.add(
            ids=ids,
            embeddings=embeddings,
            metadatas=metadatas,
            documents=documents
        )

    print(f"✅ Re-indexing complete! {collection.count()} chunks added to {DB_DIR}.")

if __name__ == "__main__":
    reindex()
