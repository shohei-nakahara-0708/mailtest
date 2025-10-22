import express from "express";
import cors from "cors";
import axios from "axios";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(cors({ origin: "*" })); // CLMなどからのfetch許可

// === Vault設定 ===
const VAULT_DOMAIN = process.env.VAULT_DOMAIN;
const VAULT_VERSION = process.env.VAULT_API_VERSION || "v23.1";
const SESSION_ID = process.env.VAULT_SESSION_ID;

// === Gmail設定 ===
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS, // Gmailアプリパスワード
  },
});

// === Vaultファイル取得関数 ===
async function fetchVaultFile(documentId) {
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

  return {
    filename: fileName,
    content: Buffer.from(res.data),
  };
}

// === メール送信API ===
app.post("/print", async (req, res) => {
  try {
    const { documentIds, orders } = req.body;

    if (!documentIds || documentIds.length === 0) {
      return res.status(400).json({ error: "documentIds is required" });
    }

    console.log("📦 取得リクエスト:", documentIds);

    const attachments = [];
    const results = [];

    for (const documentId of documentIds) {
      const copies = orders?.[documentId]?.copies || "未指定";
      const dueDate = orders?.[documentId]?.dueDate || "未指定";
      const attachment = await fetchVaultFile(documentId);
      attachments.push(attachment);
      results.push({ documentId, copies, dueDate, filename: attachment.filename });
    }

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
      to: process.env.TO_EMAIL,
      subject: "【印刷依頼】Vault資料の印刷をお願いします",
      text: `
印刷ご担当者様

以下の資料の印刷をお願いいたします。
${mailText}

添付ファイルをご確認ください。

---
自動送信：Veeva Vault 印刷連携システム
      `,
      attachments,
    };

    console.log("📧 メール送信中...");
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ メール送信完了:", info.response);

    res.json({ status: "ok", sent: info.response, files: results });
  } catch (err) {
    console.error("❌ エラー:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// === 動作確認用エンドポイント ===
app.get("/", (req, res) => {
  res.send("Vault Print API is running ✅");
});

// === Render用ポート設定 ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
