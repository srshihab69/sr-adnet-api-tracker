// api/tracker.js — Vercel Serverless Function (Auto Delete + Auto Repost)
export default async function handler(req, res) {
  const BOT_TOKEN = "9157497942:AAFBdLLXxwqZiqMwMCwT-4X_xZ71jEFjyPE";
  const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
  const PROJECT_ID = "sr-adnet";

  try {
    // ১. ফায়ারবেস থেকে পাবলিশ রেকর্ডগুলো আনা
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/publishing_history`;
    const response = await fetch(firestoreUrl);
    const data = await response.json();

    const now = Date.now();
    // টেস্ট করার জন্য ১৪ মিনিট (পরবর্তীতে ২৪ ঘণ্টার জন্য: 24 * 60 * 60 * 1000)
    const EXPIRE_MS = 14 * 60 * 1000; 

    if (!data.documents || data.documents.length === 0) {
      return res.status(200).json({ 
        success: true, 
        message: "কোনো পাবলিশ রেকর্ড পাওয়া যায়নি।" 
      });
    }

    // Firestore ফিল্ড ভ্যালু পড়ার হেল্পার
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
      const lastPostedAt = Number(getVal(f.lastPostedAt) || getVal(f.timestamp) || 0);
      const chatId = String(getVal(f.channelId) || '');
      const messageId = Number(getVal(f.messageId) || 0);
      
      // মোট দিন ও বাকি দিন রিড করা
      const totalDays = Number(getVal(f.totalDays) || getVal(f.packageValue) || 1);
      const daysRemaining = Number(getVal(f.daysRemaining) ?? totalDays);
      
      const title = getVal(f.title) || '';
      const desc = getVal(f.desc) || title || 'Advertisement';
      const bannerUrl = getVal(f.bannerUrl) || '';
      const replyMarkup = getVal(f.reply_markup) || '';
      const docPath = doc.name;

      const elapsedTime = now - lastPostedAt;
      const isExpired = elapsedTime >= EXPIRE_MS;

      const logItem = {
        adCode: getVal(f.adCode) || 'N/A',
        chatId: chatId,
        messageId: messageId,
        daysRemaining: daysRemaining,
        minutesElapsed: Math.round(elapsedTime / (60 * 1000)),
        isExpired: isExpired,
        action: ""
      };

      // শুধুমাত্র Active ক্যাম্পেইন যা নির্ধারিত সময় পার হয়েছে
      if (rawStatus === 'active' && lastPostedAt > 0 && chatId && messageId) {
        
        if (isExpired) {
          
          // ধাপ ১: টেলিগ্রাম চ্যানেল থেকে আগের পুরনো পোস্ট ডিলিট করা
          let deleteSuccess = false;
          try {
            const delRes = await fetch(`${TG_API}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId
              })
            });
            const delData = await delRes.json();
            deleteSuccess = delData.ok;
            logItem.telegramDelete = delData;
          } catch (delErr) {
            logItem.deleteError = delErr.message;
          }

          // ধাপ ২: রিপোস্ট হবে নাকি ক্যাম্পেইন শেষ হবে তা নির্ধারণ
          if (daysRemaining > 1) {
            // দিন বাকি আছে! নতুন করে আবার চ্যানেলে পোস্ট পাঠানো (Auto-Repost)
            let newMsgId = null;

            try {
              if (bannerUrl && bannerUrl.length > 20) {
                // ছবি সহ পোস্ট (Base64 অথবা লিঙ্ক হ্যান্ডেল করা)
                const formData = new FormData();
                formData.append('chat_id', chatId);
                formData.append('caption', desc);
                formData.append('parse_mode', 'HTML');
                if (replyMarkup) formData.append('reply_markup', replyMarkup);

                if (bannerUrl.startsWith('data:image')) {
                  const base64Data = bannerUrl.split(',')[1];
                  const mime = bannerUrl.split(',')[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
                  const buffer = Buffer.from(base64Data, 'base64');
                  const blob = new Blob([buffer], { type: mime });
                  formData.append('photo', blob, 'banner.jpg');
                } else {
                  formData.append('photo', bannerUrl);
                }

                const postRes = await fetch(`${TG_API}/sendPhoto`, { method: 'POST', body: formData });
                const postData = await postRes.json();
                if (postData.ok) newMsgId = postData.result.message_id;
                logItem.telegramRepost = postData;
              } else {
                // শুধু টেক্সট পোস্ট
                const postRes = await fetch(`${TG_API}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text: desc,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup ? JSON.parse(replyMarkup) : null
                  })
                });
                const postData = await postRes.json();
                if (postData.ok) newMsgId = postData.result.message_id;
                logItem.telegramRepost = postData;
              }
            } catch (repostErr) {
              logItem.repostError = repostErr.message;
            }

            // নতুন পোস্ট সফল হলে ডাটাবেসে নতুন messageId ও ১ দিন কমিয়ে আপডেট করা
            if (newMsgId) {
              const newDaysLeft = daysRemaining - 1;
              await fetch(`https://firestore.googleapis.com/v1/${docPath}?updateMask.fieldPaths=messageId&updateMask.fieldPaths=lastPostedAt&updateMask.fieldPaths=daysRemaining`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fields: {
                    messageId: { integerValue: String(newMsgId) },
                    lastPostedAt: { integerValue: String(now) },
                    daysRemaining: { integerValue: String(newDaysLeft) }
                  }
                })
              });

              logItem.action = `পুরনো পোস্ট ডিলিট হয়েছে এবং নতুন পোস্ট হয়েছে (নতুন Msg ID: ${newMsgId})। বাকি আছে: ${newDaysLeft} দিন।`;
            } else {
              logItem.action = "পুরনো পোস্ট ডিলিট হয়েছে কিন্তু নতুন পোস্ট পাঠাতে সমস্যা হয়েছে।";
            }

          } else {
            // ক্যাম্পেইনের মেয়াদ শেষ (১ দিনই ছিল বা শেষ দিন) -> স্ট্যাটাস Completed করা
            await fetch(`https://firestore.googleapis.com/v1/${docPath}?updateMask.fieldPaths=status&updateMask.fieldPaths=daysRemaining`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fields: {
                  status: { stringValue: 'Completed' },
                  daysRemaining: { integerValue: "0" }
                }
              })
            });

            logItem.action = "ক্যাম্পেইনের পুরো মেয়াদ শেষ হওয়ায় পোস্ট ডিলিট এবং স্ট্যাটাস Completed করা হয়েছে।";
          }

        } else {
          const remainingMins = Math.round((EXPIRE_MS - elapsedTime) / (60 * 1000));
          logItem.action = `ডিলিট ও পরবর্তী রিপোস্ট হতে এখনো ${remainingMins} মিনিট বাকি।`;
        }

      } else {
        logItem.action = `পোস্টটি Active নয় (Status: ${rawStatus}) বা ডাটা অসম্পূর্ণ।`;
      }

      auditReport.push(logItem);
    }

    return res.status(200).json({
      success: true,
      checkTime: new Date().toLocaleTimeString(),
      report: auditReport
    });

  } catch (error) {
    console.error("Tracker Global Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
