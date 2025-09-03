const functions = require('@google-cloud/functions-framework');
const vision = require('@google-cloud/vision');
const Busboy = require('busboy');
const cors = require('cors')({origin: true});

// Vision AIクライアントを一度だけ初期化します
const visionClient = new vision.ImageAnnotatorClient();

/**
 * HTTPトリガーで起動するCloud Function
 * multipart/form-data で送信された画像を処理します
 */
functions.http('ocrProcessor', (req, res) => {
  // CORS (Cross-Origin Resource Sharing) に対応します
  // これにより、異なるドメインでホストされているフロントエンドからのリクエストを受け付けます
  cors(req, res, () => {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const busboy = Busboy({ headers: req.headers });
    let fileBuffer;

    // ファイルストリームを処理し、バッファにため込みます
    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      const chunks = [];
      file.on('data', (chunk) => {
        chunks.push(chunk);
      });
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    // ファイルの受信が完了したときの処理
    busboy.on('finish', async () => {
      if (!fileBuffer) {
        return res.status(400).send('No file uploaded.');
      }

      try {
        // Vision AI APIを呼び出してテキストを検出します
        const [result] = await visionClient.textDetection(fileBuffer);
        const detections = result.textAnnotations;
        const fullText = detections[0] ? detections[0].description : '';
        
        // 検出したテキストから必要な情報を抽出します
        const parsedData = parseReceipt(fullText);

        // 抽出したデータをJSON形式でフロントエンドに返します
        res.status(200).json(parsedData);
      } catch (error) {
        console.error('Vision API Error:', error);
        res.status(500).send('Error processing image with Vision API.');
      }
    });

    busboy.end(req.rawBody);
  });
});

/**
 * OCRで読み取った全文テキストから情報を抽出するヘルパー関数
 * @param {string} text - OCR結果の全文テキスト
 * @returns {object} - { date, amount, notes }
 */
function parseReceipt(text) {
    let date = null;
    let amount = null;
    let notes = text.split('\n')[0] || 'OCRからの摘要'; // 最初の行を摘要とする

    // 日付の抽出 (例: 2025年09月03日, 2025/09/03, 2025-09-03)
    const dateRegex = /(\d{4})[年/\-\.](\d{1,2})[月/\-\.](\d{1,2})日?/;
    const dateMatch = text.match(dateRegex);
    if (dateMatch) {
        date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
    }

    // 金額の抽出 (「合計」「請求額」「¥」「\」の近くにある数字を探す)
    const amountRegex = /(?:合計|請求額|¥|\\)\s*([\d,]+)/i;
    const amountMatch = text.match(amountRegex);
    if (amountMatch && amountMatch[1]) {
        amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
    } else {
        // 上記が見つからない場合、最大の数字を金額と見なす単純なフォールバック
        const numbers = text.match(/[\d,]+/g) || [];
        const potentialAmount = numbers
            .map(n => parseInt(n.replace(/,/g, ''), 10))
            .filter(n => !isNaN(n) && n > 0)
            .sort((a, b) => b - a)[0];
        if(potentialAmount) amount = potentialAmount;
    }

    return { date, amount, notes };
}

