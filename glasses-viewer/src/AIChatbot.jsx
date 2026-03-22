import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import './AIChatbot.css';

const AIChatbot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Greetings, I am OPTI-BOT, how may I assist you today?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [iconLoaded, setIconLoaded] = useState(false);
  const messagesEndRef = useRef(null);
  const iconRef = useRef(null);

  // 3D Icon Renderer
  useEffect(() => {
    if (!iconRef.current || isOpen) return;
    
    const mount = iconRef.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 2.5); 

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(60, 60);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 3);
    scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0xffffff, 2);
    pointLight.position.set(5, 5, 5);
    scene.add(pointLight);

    // Procedural Wayfarer Bold (Exact Replication)
    const group = new THREE.Group();
    const fM = new THREE.MeshStandardMaterial({ color: 0xa855f7, metalness: 0.1, roughness: 0.3, emissive: 0x3b0764 });
    const lM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.05, transmission: 0.8, transparent: true, opacity: 0.4 });
    
    const s = new THREE.Shape();
    s.moveTo(-0.38, 0.24); s.lineTo(0.4, 0.28); s.quadraticCurveTo(0.44, 0, 0.38, -0.24); s.lineTo(-0.36, -0.22); s.quadraticCurveTo(-0.42, 0, -0.38, 0.24);
    const rG = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(s.getPoints(32).map(p => new THREE.Vector3(p.x, p.y, 0)), true), 32, 0.04, 8, true);
    const lG = new THREE.ShapeGeometry(s);

    const tb = new THREE.Shape();
    tb.moveTo(-1.02, 0.22); tb.lineTo(1.02, 0.22); tb.lineTo(1.02, 0.36); tb.quadraticCurveTo(0, 0.40, -1.02, 0.36); tb.lineTo(-1.02, 0.22);
    const topBar = new THREE.Mesh(new THREE.ExtrudeGeometry(tb, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 3 }), fM);
    topBar.position.z = -0.03; group.add(topBar);

    [-0.52, 0.52].forEach(x => {
      const r = new THREE.Mesh(rG, fM); r.position.x = x; group.add(r);
      const l = new THREE.Mesh(lG, lM); l.position.set(x, 0, 0.005); group.add(l);
    });

    const bc = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.14, 0.04, 0), new THREE.Vector3(0, 0.10, 0.02), new THREE.Vector3(0.14, 0.04, 0)]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(bc, 16, 0.028, 8, false), fM));

    const tG = new THREE.CylinderGeometry(0.04, 0.04, 0.6, 8);
    [-0.94, 0.94].forEach(x => {
      const t = new THREE.Mesh(tG, fM); t.rotation.x = Math.PI / 2; t.position.set(x, 0.05, -0.2); group.add(t);
    });

    group.scale.setScalar(0.7); group.rotation.set(0, 0, 0); scene.add(group);
    setIconLoaded(true);

    let rafId;
    const animate = () => {
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [isOpen]);

  // Cloudflare Worker URL (public — not a secret)
  const WORKER_URL = "https://optiq.lloydthomas54321.workers.dev";

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: "If the user asks to try on glasses, go to the AR try-on tab, use the configurator, or view the impact page, you MUST include a special command in your response exactly like this: [NAVIGATE: <tab_name>] where <tab_name> is one of 'ar', 'configurator', 'scanner', or 'impact'. Do not include this command unless you are directing them to a tab." },
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage.content }
          ]
        }),
      });

      if (!res.ok) throw new Error(`Worker error ${res.status}`);

      const data = await res.json();
      const botContent = data.reply || "I'm sorry, I couldn't process that request.";
      const navMatch = botContent.match(/\[NAVIGATE:\s*([a-zA-Z]+)\]/i);
      let cleanContent = botContent;
      if (navMatch) {
        cleanContent = botContent.replace(navMatch[0], '').trim();
        const targetTab = navMatch[1].toLowerCase();
        window.dispatchEvent(new CustomEvent('ai-navigate', { detail: targetTab }));
      }
      const botMessage = {
        role: 'assistant',
        content: cleanContent || "Directing you now..."
      };
      setMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      console.error("Worker/Groq Error:", error);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "⚠️ Could not reach the AI service. Please try again later." }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="ai-chatbot-container">
      <motion.button
        className="chat-toggle"
        onClick={() => setIsOpen(!isOpen)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Toggle Chat"
      >
        {isOpen ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        ) : (
          <div style={{ position: 'relative', width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {!iconLoaded && (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute' }}><path d="M7 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0z"/><path d="M13 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0z"/><path d="M11 12h2"/><path d="M17 12V7a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v5"/><path d="M3 12h4"/><path d="M17 12h4"/></svg>
            )}
            <div ref={iconRef} style={{ width: 60, height: 60, opacity: iconLoaded ? 1 : 0, transition: 'opacity 0.3s' }} />
          </div>
        )}
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="chat-window"
            initial={{ opacity: 0, y: 50, scale: 0.9, transformOrigin: 'bottom right' }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            <div className="chat-header">
              <div className="header-info">
                <h3>OPTI-BOT</h3>
                <span className="status-badge">Online • Llama 3.3</span>
              </div>
            </div>
            
            <div className="chat-messages">
              {messages.map((msg, index) => (
                <div key={index} className={`message-wrapper ${msg.role}`}>
                  <div className="message-bubble">
                    {msg.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="message-wrapper assistant">
                  <div className="message-bubble loading">
                    <div className="typing-dots">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="chat-input-area" onSubmit={handleSendMessage}>
              <input
                type="text"
                placeholder="Ask me about our glasses..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isLoading}
              />
              <button type="submit" disabled={isLoading || !input.trim()} className="send-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AIChatbot;
