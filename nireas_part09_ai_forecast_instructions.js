/* ===================== AI FORECAST INSTRUCTIONS ===================== */
const AI_FORECAST_INSTRUCTIONS_HTML = `
  <div style="padding:12px 14px;">
    <div style="font-weight:900;margin-bottom:6px;">Οδηγίες προς AI για πρόγνωση</div>
    <div style="font-size:12px;color:#4b4b4b;margin-bottom:10px;">
      Χρησιμοποίησε <b>μόνο</b> τα δεδομένα που παρέχονται από το σύστημα NIREAS. Μην κάνεις εικασίες.
    </div>
    <div style="margin-bottom:10px;">
      <div style="font-weight:800;margin-bottom:4px;">Ζητούμενα</div>
      <ol style="margin:0;padding-left:18px;font-size:12px;color:#2b3a44;line-height:1.45;">
        <li>Σύντομη πρόγνωση καιρού για τις επόμενες 6/24/48 ώρες.</li>
        <li>Εκτίμηση κινδύνου (χαμηλό/μέτριο/υψηλό) ανάλογα με το ενεργό σενάριο.</li>
        <li>3 άμεσες επιχειρησιακές συστάσεις για τον Δήμο.</li>
      </ol>
    </div>
    <div style="margin-bottom:10px;">
      <div style="font-weight:800;margin-bottom:4px;">Κανόνες μορφοποίησης</div>
      <ul style="margin:0;padding-left:18px;font-size:12px;color:#2b3a44;line-height:1.45;">
        <li>Σύντομα bullets, χωρίς υπερβολές.</li>
        <li>Αν κάτι λείπει, γράψε «—» και προχώρα.</li>
        <li>Αναφορά σε χρονικές σφραγίδες και τιμές όπου υπάρχουν.</li>
      </ul>
    </div>
    <div style="font-size:11px;color:#6b7a86;">
      Σημείωση: Τα δεδομένα μπορεί να είναι τοπικά/ζωντανά· μην τα συνδυάζεις με εξωτερικές πηγές.
    </div>
    <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #d6dde4;">
      <div style="font-weight:800;margin-bottom:6px;">Αυτόματη αποστολή σε API</div>
      <div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));font-size:12px;color:#2b3a44;">
        <label style="display:flex;align-items:center;gap:6px;">
          <input id="aiAutoSendToggle" type="checkbox" />
          Ενεργοποίηση αποστολής
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">
          Provider
          <select id="aiAutoSendProvider" style="height:28px;">
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
            <option value="custom">Custom Endpoint</option>
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">
          Model
          <input id="aiAutoSendModel" type="text" placeholder="gpt-4o-mini / gemini-1.5-pro" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">
          API Key
          <input id="aiAutoSendKey" type="password" placeholder="paste key" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">
          Custom URL (optional)
          <input id="aiAutoSendEndpoint" type="text" placeholder="https://example.com/ai" />
        </label>
      </div>
      <div style="font-size:11px;color:#6b7a86;margin-top:6px;">
        Τα στοιχεία αποθηκεύονται τοπικά στον browser (localStorage).
      </div>
    </div>
  </div>
`;

function initAIForecastInstructions(){
  const el = document.getElementById('aiForecastInstructions');
  if(!el) return;
  el.innerHTML = AI_FORECAST_INSTRUCTIONS_HTML;

  const toggle = document.getElementById('aiAutoSendToggle');
  const provider = document.getElementById('aiAutoSendProvider');
  const model = document.getElementById('aiAutoSendModel');
  const key = document.getElementById('aiAutoSendKey');
  const endpoint = document.getElementById('aiAutoSendEndpoint');

  if(!toggle || !provider || !model || !key || !endpoint) return;

  const saved = {
    enabled: localStorage.getItem('NIREAS_AI_AUTO_SEND') === '1',
    provider: localStorage.getItem('NIREAS_AI_AUTO_SEND_PROVIDER') || 'openai',
    model: localStorage.getItem('NIREAS_AI_AUTO_SEND_MODEL') || '',
    key: localStorage.getItem('NIREAS_AI_AUTO_SEND_KEY') || '',
    endpoint: localStorage.getItem('NIREAS_AI_AUTO_SEND_ENDPOINT') || ''
  };

  toggle.checked = saved.enabled;
  provider.value = saved.provider;
  model.value = saved.model;
  key.value = saved.key;
  endpoint.value = saved.endpoint;

  const save = () => {
    localStorage.setItem('NIREAS_AI_AUTO_SEND', toggle.checked ? '1' : '0');
    localStorage.setItem('NIREAS_AI_AUTO_SEND_PROVIDER', provider.value);
    localStorage.setItem('NIREAS_AI_AUTO_SEND_MODEL', model.value.trim());
    localStorage.setItem('NIREAS_AI_AUTO_SEND_KEY', key.value.trim());
    localStorage.setItem('NIREAS_AI_AUTO_SEND_ENDPOINT', endpoint.value.trim());
  };

  toggle.addEventListener('change', save);
  provider.addEventListener('change', save);
  model.addEventListener('change', save);
  key.addEventListener('change', save);
  endpoint.addEventListener('change', save);
}
/* ===================== /AI FORECAST INSTRUCTIONS ===================== */
