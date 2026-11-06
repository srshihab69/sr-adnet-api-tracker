// api/tracker.js — Vercel Serverless Function
export default async function handler(req, res) {
  const BOT_TOKEN = "9157497942:AAFBdLLXxwqZiqMwMCwT-4X_xZ71jEFjyPE";
  const PROJECT_ID = "sr-adnet";

  try {
    // ১. ফায়ারবেস থেকে পাবলিশ হিস্ট্রি রিড করা
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/publishing_history`;
    const response = await fetch(firestoreUrl);
    const data = await response.json();

    const now = Date.now();
    // টেস্ট করার জন্য ১৪ মিনিট (পরবর্তীতে ২৪ ঘণ্টার জন্য: 24 * 60 * 60 * 1000)
    const EXPIRE_MS = 14 * 60 * 1000; 

    if (!data.documents || data.documents.length === 0) {
      return res.status(200).json({ 
        success: true, 
        message: "কোনো পাবলিশ রেকর্ড খুঁজে পাওয়া যায়নি।",
        foundDocs: 0
      });
    }

    // যেকোনো Firestore ফিল্ড সঠিকভাবে রিড করার হেল্পার
    const getVal = (field) => {
      if (!field) return null;
      if (field.stringValue !== undefined) return field.stringValue;
      if (field.integerValue !== undefined) return Number(field.integerValue);
      if (field.doubleValue !== undefined) return Number(field.doubleValue);
      if (field.booleanValue !== undefined) return field.booleanValue;
      return null;
    };

    const auditReport = [];

    for (const doc of data.documents) {
      const f = doc.fields || {};
      
      const rawStatus = (getVal(f.status) || '').toLowerCase();
      const timestamp = Number(getVal(f.lastPostedAt) || getVal(f.timestamp) || 0);
      const chatId = String(getVal(f.channelId) || '');
      const messageId = Number(getVal(f.messageId) || 0);
      const docPath = doc.name;

      const elapsedTime = now - timestamp;
      const isExpired = elapsedTime >= EXPIRE_MS;

      const logItem = {
        adCode: getVal(f.adCode) || 'N/A',
        chatId: chatId,
        messageId: messageId,
        status: rawStatus,
        minutesElapsed: Math.round(elapsedTime / (60 * 1000)),
        isExpired: isExpired,
        result: ""
      };

      // 'active' অথবা 'success' উভয় স্ট্যাটাসই গ্রহণ করবে
      if ((rawStatus === 'active' || rawStatus === 'success') && timestamp > 0 && chatId && messageId) {
        
        if (isExpired) {
          // ২. টেলিগ্রাম মেসেজ ডিলিট এপিআই কল
          const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId
            })
          });
          const tgData = await tgRes.json();
          logItem.telegramResponse = tgData;

          if (tgData.ok) {
            logItem.result = "পোস্ট সফলভাবে চ্যানেল থেকে ডিলিট হয়েছে!";

            // ৩. ডাটাবেসে স্ট্যাটাস 'Completed' করা
            try {
              await fetch(`https://firestore.googleapis.com/v1/${docPath}?updateMask.fieldPaths=status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fields: { status: { stringValue: 'Completed' } }
                })
              });
            } catch (patchErr) {
              logItem.dbUpdateError = patchErr.message;
            }
          } else {
            logItem.result = `টেলিগ্রাম এরর: ${tgData.description}`;
          }
        } else {
          const remainingMins = Math.round((EXPIRE_MS - elapsedTime) / (60 * 1000));
          logItem.result = `ডিলিট হতে এখনো ${remainingMins} মিনিট বাকি আছে।`;
        }

      } else {
        logItem.result = "পোস্টটি Active নয় অথবা প্রয়োজনীয় তথ্য পাওয়া যায়নি।";
      }

      auditReport.push(logItem);
    }

    // ব্রাউজারে পরিষ্কার লাইভ রিপোর্ট দেখাবে
    return res.status(200).json({
      success: true,
      currentTime: new Date().toLocaleTimeString(),
      checkedCount: data.documents.length,
      report: auditReport
    });

  } catch (error) {
    console.error("Cron Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
