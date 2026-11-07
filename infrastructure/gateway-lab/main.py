# StealthMark Agent Gateway — Main Entrypoint
from gateway.app import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8080)
