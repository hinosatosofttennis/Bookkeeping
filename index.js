const functions = require('@google-cloud/functions-framework');
const vision = require('@google-cloud/vision');
const Busboy = require('busboy');

// Vision AIクライアントを初期化
const visionClient = new vision.ImageAnnotatorClient();

/**
 * HTTPトリガーで起動するCloud Function
 * multipart/form-data で送信された画像を処理します
 */
functions.http('ocrProcessor', async (req, res) => {
  // CORSヘッダーを設定し、どのオリジンからでもアクセスを許可します
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  // ブラウザが送信するプリフライトリクエスト(OPTIONS)に対応します
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const fileBuffer = await parseMultipartForm(req);
    
    if (!fileBuffer) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Vision AI APIを呼び出してテキストを検出
    const [result] = await visionClient.textDetection(fileBuffer);
    const detections = result.textAnnotations;
    const fullText = detections.length > 0 ? detections[0].description : '';
    
    // 検出したテキストから必要な情報を抽出
    const parsedData = parseReceipt(fullText);
    
    // 結果をJSON形式で返します
    res.status(200).json(parsedData);

  } catch (error) {
    console.error('Error processing OCR:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * マルチパートフォームデータを解析してファイルバッファを取得するPromiseベースの関数
 */
function parseMultipartForm(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    let fileBuffer = null;

    busboy.on('file', (fieldname, file, info) => {
      const chunks = [];
      
      file.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on('finish', () => {
      resolve(fileBuffer);
    });

    busboy.on('error', (error) => {
      reject(error);
    });

    // リクエストストリームをbusboyに渡します
    req.pipe(busboy);
  });
}

/**
 * OCRで読み取った全文テキストから情報を抽出するヘルパー関数
 * @param {string} text - OCR結果の全文テキスト
 * @returns {object} - { date, amount, notes }
 */
function parseReceipt(text) {
  let date = null;
  let amount = null;
  let notes = text.split('\n')[0] || 'OCRからの摘要';

  // 日付の抽出 (例: 2025年09月03日, 2025/09/03, 2025-09-03)
  const dateRegex = /(\d{4})[年/\-\.](\d{1,2})[月/\-\.](\d{1,2})日?/;
  const dateMatch = text.match(dateRegex);
  if (dateMatch) {
    const year = dateMatch[1];
    const month = dateMatch[2].padStart(2, '0');
    const day = dateMatch[3].padStart(2, '0');
    date = `${year}-${month}-${day}`;
  }

  // 金額の抽出（複数のパターンで試行）
  const amountPatterns = [
    /(?:合計|請求額|¥|\\)\s*([\d,]+)/i,
    /(\d{1,3}(?:,\d{3})*)\s*円/,
    /(\d{1,3}(?:,\d{3})*)\s*¥/
  ];

  for (const pattern of amountPatterns) {
    const amountMatch = text.match(pattern);
    if (amountMatch && amountMatch[1]) {
      const cleanAmount = amountMatch[1].replace(/,/g, '');
      const parsedAmount = parseInt(cleanAmount, 10);
      if (!isNaN(parsedAmount) && parsedAmount > 0) {
        amount = parsedAmount;
        break;
      }
    }
  }

  // フォールバック: 100円以上の最大の数字を金額と見なす
  if (!amount) {
    const numbers = text.match(/\d{1,3}(?:,\d{3})*/g) || [];
    const potentialAmounts = numbers
      .map(n => parseInt(n.replace(/,/g, ''), 10))
      .filter(n => !isNaN(n) && n > 100) 
      .sort((a, b) => b - a);
    
    if (potentialAmounts.length > 0) {
      amount = potentialAmounts[0];
    }
  }

  return { 
    date: date || new Date().toISOString().slice(0, 10), // 日付が見つからない場合は今日の日付
    amount: amount || 0, // 金額が見つからない場合は0
    notes: notes.substring(0, 50) // 摘要は50文字以内に制限
  };
}

