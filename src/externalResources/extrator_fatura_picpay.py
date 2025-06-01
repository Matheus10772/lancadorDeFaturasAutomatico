import pdfplumber
import pandas as pd
import re

pdf_path = "PicPay_Fatura_032025.pdf"
transacoes = []

# Regex mais permissiva para encontrar várias transações por linha
regex_todas_transacoes = re.compile(r'(\d{2}/\d{2})\s+([A-Z0-9Ç*.\-/ ]+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})')

with pdfplumber.open(pdf_path) as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        if not text:
            continue
        for line in text.split('\n'):
            # Encontra todas as transações dentro da linha
            matches = regex_todas_transacoes.findall(line)
            for data, estabelecimento, valor in matches:
                valor_float = float(valor.replace('.', '').replace(',', '.'))
                transacoes.append({
                    'Data': data,
                    'Estabelecimento': estabelecimento.strip(),
                    'Valor (R$)': valor_float
                })

# Salva em CSV
df = pd.DataFrame(transacoes)
df.to_csv("fatura_picpay_corrigida.csv", index=False, encoding='utf-8-sig')
print("CSV corrigido salvo com sucesso.")
