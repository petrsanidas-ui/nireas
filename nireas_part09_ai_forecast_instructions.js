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
  </div>
`;

function initAIForecastInstructions(){
  const el = document.getElementById('aiForecastInstructions');
  if(!el) return;
  el.innerHTML = AI_FORECAST_INSTRUCTIONS_HTML;
}
/* ===================== /AI FORECAST INSTRUCTIONS ===================== */
