FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home sillage
COPY --chown=sillage:sillage server.py database.py receipts.py ./
COPY --chown=sillage:sillage migrations ./migrations
COPY --chown=sillage:sillage public ./public
COPY --chown=sillage:sillage scripts/recover.py ./scripts/recover.py
USER sillage
EXPOSE 8080
CMD ["python", "server.py"]
