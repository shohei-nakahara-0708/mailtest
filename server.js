import express from "express";
import cors from "cors";
import axios from "axios";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import sgMail from "@sendgrid/mail";

dotenv.config();

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(cors({ origin: "*" })); // CLMなどからのfetch許可

// === Vault設定 ===
const VAULT_DOMAIN = process.env.VAULT_DOMAIN;
const VAULT_VERSION = process.env.VAULT_API_VERSION || "v23.1";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// const SESSION_ID = process.env.VAULT_SESSION_ID;

// === Gmail設定 ===
const transporter = nodemailer.createTransport({
  host: "smtp.sendgrid.net",
  port: 587,
  auth: {
    user: "apikey",  // ← 固定
    pass: process.env.SENDGRID_API_KEY, // ← SendGridのAPIキー
  },
});

// === Vaultファイル取得関数 ===
async function fetchVaultFile(documentId) {

  const authRes = await axios.post(
  `https://${VAULT_DOMAIN}/api/v23.1/auth`,
  new URLSearchParams({
    username: process.env.VAULT_USER,
    password: process.env.VAULT_PASS,
  }),
  { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
);

  const SESSION_ID = authRes.data.sessionId;

  console.log(SESSION_ID);
  
  
  const url = `https://${VAULT_DOMAIN}/api/${VAULT_VERSION}/objects/documents/${documentId}/file`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${SESSION_ID}`, Accept: "*/*" },
    responseType: "arraybuffer",
  });

  // ファイル名抽出
  let fileName = `vault_${documentId}.bin`;
  const disp = res.headers["content-disposition"];
  if (disp) {
    const match = disp.match(/filename\*?=['"]?UTF-8''([^'"]+)/i);
    if (match) fileName = decodeURIComponent(match[1]);
  }

   const rawType = res.headers["content-type"] || "application/pdf";
  const cleanType = rawType.split(";")[0].trim();

  return {
    filename: fileName,
    content: Buffer.from(res.data).toString("base64"),// ← APIはbase64形式
    type: cleanType,
  };
}

// === メール送信API ===
app.post("/print", async (req, res) => {
  try {
    const { documentIds, orders, toEmail } = req.body;
    
    console.log(toEmail);
    

    if (!documentIds || documentIds.length === 0) {
      return res.status(400).json({ error: "documentIds is required" });
    }

    console.log(" 取得リクエスト:", documentIds);

    const attachments = [];
    const results = [];

    for (const documentId of documentIds) {
      const copies = orders?.[documentId]?.copies || "未指定";
      const dueDate = orders?.[documentId]?.dueDate || "未指定";
      const attachment = await fetchVaultFile(documentId);
      attachments.push(attachment);
      results.push({ documentId, copies, dueDate, filename: attachment.filename });
    }

    console.log(attachments);
    

    let mailText = "";
    for (const ret of results) {
      mailText += `
添付ファイル名: ${ret.filename}
部数: ${ret.copies}部
納期: ${ret.dueDate}
`;
    }

    const mailOptions = {
      from: process.env.MAIL_USER,
      to: toEmail,
      subject: "【印刷依頼】Vault資料の印刷をお願いします",
      text: `
印刷ご担当者様

以下の資料の印刷をお願いいたします。
${mailText}

添付ファイルをご確認ください。

---
自動送信：Veeva Vault 印刷連携システム
      `,
      attachments: attachments.map((a) => ({
        content: a.content,
        filename: a.filename,
        type: a.type,
        disposition: "attachment",
      })),
    };

    let totalSize = attachments.reduce((sum, att) => sum + att.content.length, 0);
    console.log(`📎 添付ファイル合計サイズ: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

    try {
  console.log("メール送信中...");
  const info = await sgMail.send(mailOptions);
  console.log("メール送信完了:", info.response);
  res.json({ ok: true, info });
} catch (err) {
  console.error(" メール送信エラー詳細:", err);
  res.status(500).json({ error: err.message, details: err.response?.body });
}

    
  } catch (err) {
    console.error(" エラー:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === 動作確認用エンドポイント ===
app.get("/", (req, res) => {
  res.send("Vault Print API is running ✅");
});

app.get("/test-vault", async (req, res) => {
  try {
    const authRes = await axios.post(
  `https://${VAULT_DOMAIN}/api/v23.1/auth`,
  new URLSearchParams({
    username: process.env.VAULT_USER,
    password: process.env.VAULT_PASS,
  }),
  { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
);

  const SESSION_ID = authRes.data.sessionId;
    res.json({ status: "ok", message: "Vault reachable", data: SESSION_ID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// === Render用ポート設定 ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
