/* =========================================================================
   DIVA — assets/js/demo-data.js
   Frontend-only DEMO DATA. This file stands in for the PHP /api endpoints
   until the backend (Phase 3+ of the build plan) is connected. Every value
   here is clearly labeled DEMO DATA in the UI — nothing here should ever be
   presented to the user as a live PHIVOLCS/PAGASA/OpenWeather reading.
   ========================================================================= */

const DIVA_DEMO = {
  volcanoes: [
    { name: "Mayon Volcano", location: "Albay, Bicol Region", level: 3, status: "High-Level Unrest", eruptions: 51, updated: "2026-08-20 06:00 PST", lat: 13.2572, lng: 123.6856, desc: "Increased seismicity and lava effusion at the summit crater." },
    { name: "Taal Volcano", location: "Batangas, Calabarzon", level: 1, status: "Low-Level Unrest", eruptions: 33, updated: "2026-08-20 06:00 PST", lat: 14.0021, lng: 120.9932, desc: "Continuing background degassing from the Main Crater." },
    { name: "Mount Pinatubo", location: "Zambales/Pampanga/Tarlac", level: 0, status: "Normal", eruptions: 6, updated: "2026-08-19 18:00 PST", lat: 15.1300, lng: 120.3500, desc: "No significant deformation or seismic anomalies recorded." },
    { name: "Kanlaon Volcano", location: "Negros Occidental", level: 2, status: "Moderate Unrest", eruptions: 30, updated: "2026-08-20 06:00 PST", lat: 10.4122, lng: 123.1322, desc: "Intermittent phreatic activity and elevated SO2 flux." },
    { name: "Bulusan Volcano", location: "Sorsogon, Bicol Region", level: 0, status: "Normal", eruptions: 18, updated: "2026-08-19 18:00 PST", lat: 12.7700, lng: 124.0500, desc: "Quiescent; occasional steam emission from the summit." },
    { name: "Hibok-Hibok Volcano", location: "Camiguin", level: 0, status: "Normal", eruptions: 6, updated: "2026-08-18 18:00 PST", lat: 9.2039, lng: 124.6750, desc: "No unusual activity observed in the past monitoring period." },
  ],

  alerts: [
    { title: "Severe Wind and Rainfall Advisory", type: "Typhoon", severity: "warning", area: "Bicol Region, Eastern Visayas", message: "A tropical cyclone is expected to bring heavy to intense rainfall. Residents in low-lying and landslide-prone areas should prepare to evacuate.", start: "2026-08-21 06:00", expires: "2026-08-23 06:00" },
    { title: "Mayon Volcano Alert Level 3", type: "Volcanic", severity: "critical", area: "6-7km radius, Albay", message: "PHIVOLCS maintains Alert Level 3 over Mayon Volcano. Entry into the 6-km Permanent Danger Zone is strictly prohibited.", start: "2026-08-18 08:00", expires: "2026-08-25 08:00" },
    { title: "Localized Flooding Advisory", type: "Flood", severity: "advisory", area: "Marikina River Basin", message: "Water levels are within monitoring range. Residents near the riverbank are advised to stay alert for updates.", start: "2026-08-20 14:00", expires: "2026-08-22 14:00" },
  ],

  emergencyContacts: [
    { name: "Philippine National Police", number: "117", tag: "Police" },
    { name: "Bureau of Fire Protection", number: "160", tag: "Fire" },
    { name: "Medical Emergency", number: "911", tag: "Medical" },
    { name: "NDRRMC Operations Center", number: "(02) 8911-1406", tag: "NDRRMC" },
  ],

  evacuationCenters: [
    { name: "Barangay San Isidro Covered Court", address: "San Isidro, Calamba, Laguna", lat: 14.2120, lng: 121.1650, contact: "(049) 545-1122", facilities: "Water, medical station, generator" },
    { name: "Calamba City Sports Complex", address: "Real St, Calamba, Laguna", lat: 14.2141, lng: 121.1653, contact: "(049) 545-3390", facilities: "Water, generator, sleeping area" },
    { name: "Canlubang Elementary School", address: "Canlubang, Calamba, Laguna", lat: 14.1908, lng: 121.1275, contact: "(049) 549-0021", facilities: "Water, first aid" },
  ],

  quickPrompts: [
    "What to do during an earthquake?",
    "How to prepare for a typhoon?",
    "Volcanic eruption signs?",
    "Where can I find emergency contacts?",
  ],

  aiReplies: {
    en: {
      earthquake: "During an earthquake: Drop, Cover, and Hold On. Get under sturdy furniture, stay away from windows, and if outdoors, move to an open area away from buildings and power lines. After shaking stops, check for injuries and hazards like gas leaks before evacuating calmly.",
      typhoon: "To prepare for a typhoon: secure loose outdoor items, charge devices and power banks, store at least 3 days of water and food, know your barangay's evacuation center, and monitor official PAGASA bulletins for updates on the storm's track and signal number.",
      volcano: "Signs of possible volcanic unrest include increased seismicity, ground deformation, sulfur odor, and steaming. Always rely on official PHIVOLCS alert levels rather than these signs alone, and follow evacuation guidance for your area's danger zone if authorities issue one.",
      contacts: "You can find official emergency numbers on the Emergency page of DIVA — Police (117), Fire (160), Medical Emergency (911), and the NDRRMC Operations Center. Tap any number there to call directly.",
      default: "I can help with general guidance on earthquakes, typhoons, floods, volcanic eruptions, and evacuation preparedness. For life-threatening emergencies happening right now, please contact 911 or your local emergency services immediately — I'm not a substitute for official responders.",
    },
    fil: {
      earthquake: "Sa panahon ng lindol: Duck, Cover, at Hold. Pumasok sa ilalim ng matibay na mesa, lumayo sa bintana, at kung nasa labas, pumunta sa bukas na lugar na malayo sa gusali at wire. Pagkatapos ng pagyanig, suriin ang mga sugat at panganib tulad ng gas leak bago lumikas nang mahinahon.",
      typhoon: "Sa paghahanda para sa bagyo: siguraduhing naka-ayos ang mga bagay sa labas, i-charge ang mga gamit, mag-imbak ng tubig at pagkain para sa hindi bababa sa 3 araw, alamin ang evacuation center ng inyong barangay, at bantayan ang opisyal na bulletin ng PAGASA.",
      volcano: "Ang mga senyales ng posibleng aktibidad ng bulkan ay kinabibilangan ng dagdag na seismicity, pagbabago ng hugis ng lupa, amoy asupre, at pag-usok. Palaging sumangguni sa opisyal na alert level ng PHIVOLCS at sumunod sa evacuation guidance kung ito ay ipinag-utos.",
      contacts: "Makikita mo ang opisyal na numero ng emergency sa Emergency page ng DIVA — Pulis (117), Bumbero (160), Medical Emergency (911), at ang NDRRMC Operations Center.",
      default: "Kaya kong tumulong sa pangkalahatang gabay tungkol sa lindol, bagyo, baha, pagputok ng bulkan, at paghahanda sa evacuation. Para sa emergency na banta sa buhay ngayon, mangyaring tumawag agad sa 911 o sa lokal na emergency services — hindi ako kapalit ng opisyal na responder.",
    },
  },
};
