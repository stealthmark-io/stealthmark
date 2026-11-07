from gateway.app import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("stealthmark_gateway:app", host="0.0.0.0", port=8080)
