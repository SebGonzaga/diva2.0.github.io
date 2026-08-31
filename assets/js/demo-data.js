/* =========================================================================
   DIVA — assets/js/demo-data.js
   Frontend-only DEMO DATA. This file stands in for the PHP /api endpoints
   until the backend (Phase 3+ of the build plan) is connected. Every value
   here is clearly labeled DEMO DATA in the UI — nothing here should ever be
   presented to the user as a live PHIVOLCS/PAGASA/OpenWeather reading.
   ========================================================================= */

/** Builds a structured DIVA chat reply: icon + heading, intro line,
 *  a numbered "what to do" list, and an optional follow-up action link. */
function divaStructuredReply(r) {
  const steps = r.steps.map((s, i) => `<li><span class="step-num">${String(i + 1).padStart(2, "0")}</span><span>${s}</span></li>`).join("");
  const cta = r.cta ? `<a href="${r.cta.href}" class="btn-diva btn-diva-primary btn-diva-sm mt-2">${r.cta.label} <i class="bi bi-arrow-right"></i></a>` : "";
  return `<div class="diva-reply tone-${r.tone}">
    <div class="diva-reply-heading"><i class="bi ${r.icon}"></i> ${r.heading}</div>
    <p class="diva-reply-intro">${r.intro}</p>
    <div class="diva-reply-label">What to do</div>
    <ol class="diva-reply-steps">${steps}</ol>
    ${cta}
  </div>`;
}

// Lighter variant of divaStructuredReply for questions the chatbot can't
// answer with live numbers (incidents/alerts/weather/quakes near you) —
// no "What to do" steps list, just a short note + a button to the page
// that actually has that data. See virtual-assistance.html's
// detectDataIntent().
function divaQuickLinkReply(r) {
  const cta = r.cta ? `<a href="${r.cta.href}" class="btn-diva btn-diva-primary btn-diva-sm mt-2">${r.cta.label} <i class="bi bi-arrow-right"></i></a>` : "";
  return `<div class="diva-reply tone-${r.tone || "info"}">
    <div class="diva-reply-heading"><i class="bi ${r.icon}"></i> ${r.heading}</div>
    <p class="diva-reply-intro">${r.intro}</p>
    ${cta}
  </div>`;
}

const DIVA_DEMO = {
  // Composite community risk score for the Dashboard's risk meter.
  // DEMO DATA — a real deployment would derive this from live PAGASA/
  // PHIVOLCS/NDRRMC feeds plus the user's registered barangay.
  // NOTE: Community Risk is intentionally NOT seeded here. It's computed
  // live in dashboard.html from the app's real current state (active alerts,
  // resident-submitted incidents, volcano alert levels, and the cached
  // weather reading) instead of being a fabricated static number — see
  // computeCommunityRisk() in dashboard.html.

  // Reported incidents shown on the Live Situation Map. DEMO DATA.
  incidents: [
    { title: "Ashfall reported", lat: 14.2205, lng: 121.1580, area: "Brgy. Real, Calamba", updated: "18 min ago" },
    { title: "Road flooding", lat: 14.2050, lng: 121.1720, area: "Brgy. Halang, Calamba", updated: "42 min ago" },
  ],

  volcanoes: [
    { name: "Mayon Volcano", location: "Albay, Bicol Region", level: 3, status: "High-Level Unrest", eruptions: 51, updated: "2026-08-20 06:00 PST", lat: 13.2572, lng: 123.6856, desc: "Increased seismicity and lava effusion at the summit crater." },
    { name: "Taal Volcano", location: "Batangas, Calabarzon", level: 1, status: "Low-Level Unrest", eruptions: 33, updated: "2026-08-20 06:00 PST", lat: 14.0021, lng: 120.9932, desc: "Continuing background degassing from the Main Crater." },
    { name: "Mount Pinatubo", location: "Zambales/Pampanga/Tarlac", level: 0, status: "Normal", eruptions: 6, updated: "2026-08-19 18:00 PST", lat: 15.1300, lng: 120.3500, desc: "No significant deformation or seismic anomalies recorded." },
    { name: "Kanlaon Volcano", location: "Negros Occidental", level: 2, status: "Moderate Unrest", eruptions: 30, updated: "2026-08-20 06:00 PST", lat: 10.4122, lng: 123.1322, desc: "Intermittent phreatic activity and elevated SO2 flux." },
    { name: "Bulusan Volcano", location: "Sorsogon, Bicol Region", level: 0, status: "Normal", eruptions: 18, updated: "2026-08-19 18:00 PST", lat: 12.7700, lng: 124.0500, desc: "Quiescent; occasional steam emission from the summit." },
    { name: "Hibok-Hibok Volcano", location: "Camiguin", level: 0, status: "Normal", eruptions: 6, updated: "2026-08-18 18:00 PST", lat: 9.2039, lng: 124.6750, desc: "No unusual activity observed in the past monitoring period." },
  ],

  // Each alert carries its OWN real coordinates now (matching its "area"
  // text) instead of being plotted at a fabricated offset from the user's
  // location. The dashboard's local map only pins alerts that are actually
  // near the user — see distance filtering in dashboard.html.
  alerts: [
    { title: "Severe Wind and Rainfall Advisory", type: "Typhoon", severity: "warning", area: "Bicol Region, Eastern Visayas", lat: 13.4210, lng: 123.4130, message: "A tropical cyclone is expected to bring heavy to intense rainfall. Residents in low-lying and landslide-prone areas should prepare to evacuate.", start: "2026-08-21 06:00", expires: "2026-08-23 06:00" },
    { title: "Mayon Volcano Alert Level 3", type: "Volcanic", severity: "critical", area: "6-7km radius, Albay", lat: 13.2572, lng: 123.6856, message: "PHIVOLCS maintains Alert Level 3 over Mayon Volcano. Entry into the 6-km Permanent Danger Zone is strictly prohibited.", start: "2026-08-18 08:00", expires: "2026-08-25 08:00" },
    { title: "Marikina River Water Level Advisory", type: "Flood", severity: "advisory", area: "Marikina River Basin", lat: 14.6507, lng: 121.1029, message: "Water levels are within monitoring range. Residents near the riverbank are advised to stay alert for updates.", start: "2026-08-20 14:00", expires: "2026-08-22 14:00" },
    { title: "Laguna Lake Water Level Advisory", type: "Flood", severity: "advisory", area: "Calamba, Los Baños, Laguna", lat: 14.2350, lng: 121.1900, message: "Laguna Lake water level is elevated following sustained rainfall. Residents in low-lying lakeside barangays should monitor for updates and prepare to move belongings to higher ground.", start: "2026-08-21 09:00", expires: "2026-08-23 09:00" },
  ],

  emergencyContacts: [
    { name: "Philippine National Police", number: "117", tag: "Police" },
    { name: "Bureau of Fire Protection", number: "160", tag: "Fire" },
    { name: "Medical Emergency", number: "911", tag: "Medical" },
    { name: "NDRRMC Operations Center", number: "(02) 8911-1406", tag: "NDRRMC" },
  ],

  // Each center now carries a `category` (drives the map pin color/icon —
  // "shelter" | "government" | "mall") and a human-readable `type` label
  // shown as a badge in the list. Coordinates are town-center approximations
  // (same convention as assets/js/taal-places.js) — good for nearest-match
  // and general map placement, not precise addressing.
  evacuationCenters: [
    // --- Calamba, Laguna ---
    { name: "Barangay San Isidro Covered Court", type: "Covered Court", category: "shelter", address: "San Isidro, Calamba, Laguna", lat: 14.2120, lng: 121.1650, contact: "(049) 545-1122", facilities: "Water, medical station, generator" },
    { name: "Calamba City Sports Complex", type: "Sports Complex", category: "shelter", address: "Real St, Calamba, Laguna", lat: 14.2141, lng: 121.1653, contact: "(049) 545-3390", facilities: "Water, generator, sleeping area" },
    { name: "Canlubang Elementary School", type: "School", category: "shelter", address: "Canlubang, Calamba, Laguna", lat: 14.1908, lng: 121.1275, contact: "(049) 549-0021", facilities: "Water, first aid" },
    { name: "Calamba City Hall", type: "City Hall", category: "government", address: "Brgy. Real, Calamba, Laguna", lat: 14.2145, lng: 121.1649, contact: "(049) 545-1500", facilities: "Command center, registration, medical aid" },
    { name: "Barangay Real Hall", type: "Barangay Hall", category: "government", address: "Real, Calamba, Laguna", lat: 14.2205, lng: 121.1595, contact: "(049) 545-2202", facilities: "Registration, relief goods distribution" },
    { name: "Barangay Halang Multi-Purpose Hall", type: "Barangay Hall", category: "government", address: "Halang, Calamba, Laguna", lat: 14.2032, lng: 121.1710, contact: "(049) 545-2201", facilities: "Registration, temporary shelter" },
    { name: "SM City Calamba", type: "Mall (SM)", category: "mall", address: "National Hwy, Brgy. Real, Calamba, Laguna", lat: 14.2175, lng: 121.1660, contact: "(049) 545-9000", facilities: "Designated evacuation area, generator, security" },

    // --- Near Taal Volcano (Batangas / Cavite) ---
    { name: "Talisay Municipal Hall", type: "Municipal Hall", category: "government", address: "Talisay, Batangas", lat: 14.0994, lng: 121.0125, contact: "(043) 773-0121", facilities: "Command center, registration" },
    { name: "Laurel Municipal Hall", type: "Municipal Hall", category: "government", address: "Laurel, Batangas", lat: 14.0000, lng: 120.9167, contact: "(043) 778-0021", facilities: "Command center, relief goods" },
    { name: "Agoncillo Municipal Hall", type: "Municipal Hall", category: "government", address: "Agoncillo, Batangas", lat: 13.9667, lng: 120.9167, contact: "(043) 773-1021", facilities: "Command center, registration" },
    { name: "San Nicolas Municipal Hall", type: "Municipal Hall", category: "government", address: "San Nicolas, Batangas", lat: 13.9167, lng: 121.0167, contact: "(043) 706-1021", facilities: "Command center, medical aid" },
    { name: "Balete Municipal Hall", type: "Municipal Hall", category: "government", address: "Balete, Batangas", lat: 14.0167, lng: 121.0000, contact: "(043) 705-1021", facilities: "Registration, relief goods" },
    { name: "Sto. Tomas City Hall", type: "City Hall", category: "government", address: "Sto. Tomas, Batangas", lat: 14.1078, lng: 121.1414, contact: "(043) 700-1021", facilities: "Command center, medical station" },
    { name: "Tanauan City Hall", type: "City Hall", category: "government", address: "Tanauan City, Batangas", lat: 14.0863, lng: 121.1497, contact: "(043) 778-1021", facilities: "Command center, registration" },
    { name: "SM Center Tanauan", type: "Mall (SM)", category: "mall", address: "J.P. Laurel Hwy, Tanauan City, Batangas", lat: 14.0910, lng: 121.1520, contact: "(043) 778-9000", facilities: "Designated evacuation area, generator" },
    { name: "Lipa City Hall", type: "City Hall", category: "government", address: "Lipa City, Batangas", lat: 13.9411, lng: 121.1622, contact: "(043) 756-1021", facilities: "Command center, medical station" },
    { name: "SM City Lipa", type: "Mall (SM)", category: "mall", address: "Marawoy, Lipa City, Batangas", lat: 13.9550, lng: 121.1600, contact: "(043) 756-9000", facilities: "Designated evacuation area, generator, security" },
    { name: "Batangas City Hall", type: "City Hall", category: "government", address: "Batangas City, Batangas", lat: 13.7565, lng: 121.0583, contact: "(043) 723-1021", facilities: "Command center, medical station" },
    { name: "SM City Batangas", type: "Mall (SM)", category: "mall", address: "Pallocan West, Batangas City, Batangas", lat: 13.7700, lng: 121.0570, contact: "(043) 723-9000", facilities: "Designated evacuation area, generator" },
    { name: "Tagaytay City Hall", type: "City Hall", category: "government", address: "Tagaytay City, Cavite", lat: 14.0975, lng: 120.9639, contact: "(046) 483-1021", facilities: "Command center, registration" },
    { name: "SM City Tagaytay", type: "Mall (SM)", category: "mall", address: "Aguinaldo Hwy, Tagaytay City, Cavite", lat: 14.1030, lng: 120.9450, contact: "(046) 483-9000", facilities: "Designated evacuation area, generator, security" },
  ],

  quickPrompts: [
    "What to do during an earthquake?",
    "How to prepare for a typhoon?",
    "Volcanic eruption signs?",
    "Where can I find emergency contacts?",
  ],

  aiReplies: {
    en: {
      earthquake: divaStructuredReply({ icon: "bi-activity", tone: "warning", heading: "EARTHQUAKE SAFETY", intro: "Follow these steps immediately when shaking starts.", steps: ["Drop, Cover, and Hold On under sturdy furniture", "Stay away from windows and heavy objects", "If outdoors, move to an open area away from buildings and power lines", "After shaking stops, check for injuries and hazards like gas leaks before evacuating calmly"], cta: { label: "View evacuation centers", href: "emergency.html#evac" } }),
      typhoon: divaStructuredReply({ icon: "bi-hurricane", tone: "caution", heading: "TYPHOON PREPARATION", intro: "Heavy rainfall and strong winds may affect your area.", steps: ["Secure loose outdoor items", "Charge devices and power banks", "Store at least 3 days of water and food", "Know your barangay's evacuation center", "Monitor official PAGASA bulletins for the storm's track and signal number"], cta: { label: "Check current weather", href: "weather.html" } }),
      flood: divaStructuredReply({ icon: "bi-water", tone: "critical", heading: "FLOOD PRECAUTION", intro: "Heavy rainfall is currently affecting parts of your area.", steps: ["Move valuables to higher ground", "Avoid flooded roads and fast-moving water", "Prepare your emergency kit and important documents", "Follow evacuation orders from local officials without delay"], cta: { label: "View nearest shelter", href: "emergency.html#evac" } }),
      volcano: divaStructuredReply({ icon: "bi-triangle", tone: "warning", heading: "VOLCANIC ACTIVITY", intro: "Signs of possible unrest include increased seismicity, ground deformation, sulfur odor, and steaming.", steps: ["Always rely on official PHIVOLCS alert levels, not signs alone", "Avoid entry into the Permanent Danger Zone for your volcano", "Prepare dust masks and goggles in case of ashfall", "Follow evacuation guidance for your area's danger zone if issued"], cta: { label: "View volcano monitoring", href: "volcano.html" } }),
      contacts: divaStructuredReply({ icon: "bi-telephone", tone: "info", heading: "EMERGENCY CONTACTS", intro: "Official emergency numbers for the Philippines.", steps: ["Philippine National Police — 117", "Bureau of Fire Protection — 160", "Medical Emergency — 911", "NDRRMC Operations Center"], cta: { label: "Open Emergency page", href: "emergency.html" } }),
      default: "I can help with general guidance on earthquakes, typhoons, floods, volcanic eruptions, and evacuation preparedness. For life-threatening emergencies happening right now, please contact 911 or your local emergency services immediately — I'm not a substitute for official responders.",
    },
    fil: {
      earthquake: divaStructuredReply({ icon: "bi-activity", tone: "warning", heading: "KALIGTASAN SA LINDOL", intro: "Sundin ang mga hakbang na ito kapag nagsimula ang pagyanig.", steps: ["Duck, Cover, at Hold sa ilalim ng matibay na mesa", "Lumayo sa bintana at mabibigat na bagay", "Kung nasa labas, pumunta sa bukas na lugar na malayo sa gusali at wire", "Pagkatapos ng pagyanig, suriin ang mga sugat at panganib tulad ng gas leak bago lumikas"], cta: { label: "Tingnan ang evacuation centers", href: "emergency.html#evac" } }),
      typhoon: divaStructuredReply({ icon: "bi-hurricane", tone: "caution", heading: "PAGHAHANDA SA BAGYO", intro: "Maaaring magdulot ng malakas na ulan at hangin ang bagyo sa inyong lugar.", steps: ["Siguraduhing naka-ayos ang mga bagay sa labas", "I-charge ang mga gamit at power bank", "Mag-imbak ng tubig at pagkain para sa hindi bababa sa 3 araw", "Alamin ang evacuation center ng inyong barangay", "Bantayan ang opisyal na bulletin ng PAGASA"], cta: { label: "Tingnan ang panahon", href: "weather.html" } }),
      flood: divaStructuredReply({ icon: "bi-water", tone: "critical", heading: "PAG-IINGAT SA BAHA", intro: "Kasalukuyang may malakas na ulan sa ilang bahagi ng inyong lugar.", steps: ["Ilipat ang mga mahahalagang gamit sa mataas na lugar", "Iwasan ang mga bahang daan at malakas na agos", "Ihanda ang emergency kit at mahahalagang dokumento", "Sumunod agad sa evacuation order ng mga lokal na opisyal"], cta: { label: "Tingnan ang pinakamalapit na shelter", href: "emergency.html#evac" } }),
      volcano: divaStructuredReply({ icon: "bi-triangle", tone: "warning", heading: "AKTIBIDAD NG BULKAN", intro: "Ang mga senyales ng posibleng aktibidad ay kinabibilangan ng dagdag na seismicity, pagbabago ng hugis ng lupa, amoy asupre, at pag-usok.", steps: ["Palaging sumangguni sa opisyal na alert level ng PHIVOLCS", "Iwasan ang Permanent Danger Zone ng bulkan", "Maghanda ng dust mask at goggles kung sakaling umulan ng abo", "Sumunod sa evacuation guidance kung ito ay ipinag-utos"], cta: { label: "Tingnan ang volcano monitoring", href: "volcano.html" } }),
      contacts: divaStructuredReply({ icon: "bi-telephone", tone: "info", heading: "MGA EMERGENCY CONTACT", intro: "Opisyal na numero ng emergency sa Pilipinas.", steps: ["Pulis — 117", "Bumbero — 160", "Medical Emergency — 911", "NDRRMC Operations Center"], cta: { label: "Buksan ang Emergency page", href: "emergency.html" } }),
      default: "Kaya kong tumulong sa pangkalahatang gabay tungkol sa lindol, bagyo, baha, pagputok ng bulkan, at paghahanda sa evacuation. Para sa emergency na banta sa buhay ngayon, mangyaring tumawag agad sa 911 o sa lokal na emergency services — hindi ako kapalit ng opisyal na responder.",
    },
  },
};
