export default {
  async fetch(request, env, ctx) {
    return new Response('你好，我是快樂腳旅棧的 API 伺服器！');
  },

  async scheduled(event, env, ctx) {
    console.log("CRON job triggered: Syncing data from Google Sheet...");
    // 未來同步資料的程式碼會寫在這裡
  },
};