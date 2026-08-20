# Soledd LOS backend — Node/Express WhatsApp bot + admin API.
# Needs Python (pdfplumber/pypdf/reportlab) alongside Node for the
# paper-form-accurate PDF export (scripts/fill_forms.py), which a plain
# Node buildpack won't provide — hence the Docker image.

FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages pdfplumber pypdf reportlab

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/index.js"]
