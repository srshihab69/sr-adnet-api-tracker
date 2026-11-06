// api/tracker.js
export default async function handler(req, res) {
  const BOT_TOKEN = "9157497942:AAFBdLLXxwqZiqMwMCwT-4X_xZ71jEFjyPE";
  const FIREBASE_DB_URL = "https://sr-adnet-default-rtdb.firebaseio.com"; // আপনার RTDB বা Firestore REST API

  try {
    // ১. ফায়ারবেস বা আপনার ডাটাবেস থেকে একটিভ পোস্টগুলোর তথ্য আনা (REST API দিয়ে)
    // Firestore REST API: https://firestore.googleapis.com/v1/projects/sr-adnet/databases/(default)/documents/publishing_history
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/sr-adnet/databases/(default)/documents/publishing_history`);
    const data = await response.json();

    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000; // ২৪ ঘণ্টার মিলি-সেকেন্ড

    if (data.documents) {
      for (const doc of data.documents) {
        const fields = doc.fields;
        const status = fields.status?.stringValue;
        const timestamp = parseInt(fields.timestamp?.integerValue || 0);
        const chatId = fields.channelId?.stringValue;
        const messageId = fields.messageId?.integerValue;
        const packageType = fields.packageType?.stringValue || 'days';
        const packageValue = parseInt(fields.packageValue?.integerValue || 1);

        // শুধুমাত্র এক্টিভ পোস্টগুলো চেক হবে
        if (status === 'Success' && timestamp > 0) {
          const elapsedTime = now - timestamp;

          // ২৪ ঘণ্টা পূর্ণ হয়েছে কি না
          if (elapsedTime >= ONE_DAY_MS) {
            // ২. টেলিগ্রাম চ্যানেল থেকে পোস্ট ডিলিট করা
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId
              })
            });

            // ৩. স্ট্যাটাস আপডেট করে "COMPLETED" করা
            const docPath = doc.name; // Firestore document path
            await fetch(`https://firestore.googleapis.com/v1/${docPath}?updateMask.fieldPaths=status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fields: { status: { stringValue: 'Completed' } }
              })
            });

            console.log(`Deleted expired ad message ${messageId} from ${chatId}`);
          }
        }
      }
    }

    return res.status(200).json({ success: true, message: "Automation check completed." });
  } catch (error) {
    console.error("Cron Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
