/**
 * OPTIQ Chatbot – Cloudflare Worker (Groq API Proxy)
 *
 * Deploy: https://dash.cloudflare.com → Workers & Pages → Create Worker
 * Paste this code, then add Secret: GROQ_API_KEY = your Groq API key
 */

const ALLOWED_ORIGIN = "*"; // Or restrict to: "https://yoursite.vercel.app"

const SYSTEM_PROMPT = `You are OPTI-BOT, the official AI assistant for OPTIQ, a high-end, 3D-printed eyewear brand.
YOUR GOAL: Help users find the perfect glasses and explain the OPTIQ process.

MISSION:
OPTIQ uses client-side AI face-scanning and 100% recycled plastic (HDPE bottle caps) to create custom-fit, affordable eyewear (under ₱70) for low-income communities in the Philippines and SE Asia.

TOPICS YOU MUST COVER:
1. Suggesting frame styles based on face shapes using Google MediaPipe technology.
2. Recommending designs for daily needs (students, workers, elderly, etc.).
3. Sustainability: Frames are made from 100% recycled HDPE bottle caps via partnerships with Precious Plastics Philippines.
4. Manufacturing: 3D printing in local barangays to create a micro-economy and clean up plastic waste.
5. Technical: Uses React, Three.js, and MediaPipe face mesh (nose, ear, and pupillary distance mapping).
6. Outreach: Hands-on workshops at universities in Cebu to teach AI and recycling.

BE CONCISE:
- Keep answers as brief as possible while being helpful.
- For simple greetings, just say "Hello! How can I help you find your perfect OPTIQ frames today?"
- Focus only on the direct question asked.

GUARDRAILS:
- If a user asks something unrelated to OPTIQ or eyewear, politely decline and redirect.
- Keep responses professional, clear, and premium in tone.`;

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);

    if (url.pathname === "/create-checkout-session") {
      let body;
      try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

      const { name, price } = body;
      
      let formParams = new URLSearchParams();
      formParams.append('line_items[0][price_data][currency]', 'php');
      formParams.append('line_items[0][price_data][product_data][name]', name || 'Custom OPTIQ Glasses');
      formParams.append('line_items[0][price_data][unit_amount]', Math.round(price * 100).toString());
      formParams.append('line_items[0][quantity]', '1');
      formParams.append('mode', 'payment');
      const origin = request.headers.get('Origin') || 'http://localhost:5173';
      formParams.append('success_url', origin + '?success=true');
      formParams.append('cancel_url', origin + '?canceled=true');

      const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formParams
      });

      const session = await stripeResponse.json();
      if (!stripeResponse.ok) return new Response(JSON.stringify({ error: session.error }), { status: 400, headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN } });

      return new Response(JSON.stringify({ url: session.url }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN } });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const { messages } = body;
    if (!messages || !Array.isArray(messages)) {
      return new Response("Missing messages array", { status: 400 });
    }

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
      }),
    });

    if (!groqResponse.ok) {
      const error = await groqResponse.text();
      console.error("Groq API error:", error);
      return new Response("AI service error", {
        status: 502,
        headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
      });
    }

    const data = await groqResponse.json();
    const reply = data.choices?.[0]?.message?.content ?? "Sorry, I couldn't process that.";

    return new Response(JSON.stringify({ reply }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      },
    });
  },
};
