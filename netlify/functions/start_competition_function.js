// start_competition.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // must be exported from _utils.js (GoogleSpreadsheet client)
} = require("./_utils.js");

module.exports.handler = async (event) => {
  console.log("Enhanced competition control request started at:", new Date().toISOString());
  console.log("HTTP Method:", event.httpMethod);

  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    // Only POST
    if (event.httpMethod !== "POST") {
      return error(405, "Method not allowed. Use POST.");
    }

    // Parse body
    let requestData = {};
    try {
      requestData = JSON.parse(event.body || "{}");
    } catch {
      return error(400, "Invalid JSON in request body");
    }

    const {
      action, customStartTime,
      teamCode, status, penalty, returnTime, penaltyMinutes, locked
    } = requestData;

    console.log("Request data:", { action, customStartTime, teamCode, status, penalty, penaltyMinutes, locked });

    // Validate action
    const validActions = ["start", "stop", "reset", "publish_results", "update_team_status", "toggle_lock"];
    if (!action || !validActions.includes(action)) {
      return error(400, `Invalid action. Must be one of: ${validActions.join(", ")}`);
    }

    // Authenticated doc via shared utils (robust env/file fallback)
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Team management actions
    if (action === "update_team_status" || action === "toggle_lock") {
      return await handleTeamManagement(doc, action, {
        teamCode, status, penalty, returnTime, penaltyMinutes, locked
      });
    }

    // Competition control actions
    return await handleCompetitionControl(doc, action, customStartTime);

  } catch (e) {
    console.error("Enhanced competition control error:", e);
    return error(500, e.message || "Unexpected error", { timestamp: new Date().toISOString() });
  }
};

// ----- helpers (ported from your original, with small safety tweaks) -----

async function handleTeamManagement(doc, action, { teamCode, status, penalty, returnTime, penaltyMinutes, locked }) {
  console.log("Handling team management:", action, "for team:", teamCode);
  if (!teamCode) return error(400, "teamCode is required");

  const leaderboardSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Leaderboard"] : null;
  if (!leaderboardSheet) return error(404, "Leaderboard sheet not found");

  await ensurePenaltyColumns(leaderboardSheet);
  await leaderboardSheet.loadHeaderRow();
  const rows = await leaderboardSheet.getRows();

  const teamRow = rows.find((row) => row.get("Team Code") === teamCode);
  if (!teamRow) return error(404, `Team ${teamCode} not found`);

  if (action === "update_team_status") {
    console.log(`Updating team ${teamCode}: status=${status}, penalty=${penalty}`);

    if (status) teamRow.set("Status", status);
    if (penalty !== undefined && penalty !== null) {
      teamRow.set("Penalty", String(penalty));
      teamRow.set("Penalty Minutes", String(penaltyMinutes || 0));
    }
    if (returnTime) teamRow.set("Return Time", returnTime);

    await teamRow.save();

    return ok({
      success: true,
      message: `Team ${teamCode} status updated`,
      teamCode,
      status,
      penalty: penalty || 0,
    });
  }

  if (action === "toggle_lock") {
    console.log(`Toggling lock for team ${teamCode}:`, locked);
    teamRow.set("Locked", locked ? "TRUE" : "FALSE");
    await teamRow.save();

    return ok({
      success: true,
      message: `Team ${teamCode} lock status updated`,
      teamCode,
      locked: !!locked,
    });
  }

  // Shouldn't reach here
  return error(400, "Unsupported team management action");
}

async function handleCompetitionControl(doc, action, customStartTime) {
  // Get or create Competition sheet
  let competitionSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Competition"] : null;
  const now = new Date().toISOString();

  if (!competitionSheet) {
    console.log("Competition sheet not found, creating new one...");
    competitionSheet = await doc.addSheet({
      title: "Competition",
      headerValues: [
        "Status",              // started, stopped, reset
        "Start Time",          // ISO timestamp
        "Duration Minutes",    // default 90
        "Results Published",   // true/false
        "Published At",        // ISO timestamp when published
        "Created At",
        "Action By",
        "Notes",
      ],
    });
    console.log("Competition sheet created successfully");
  } else {
    await competitionSheet.loadHeaderRow();
    console.log("Competition sheet loaded successfully");
  }

  const rows = await competitionSheet.getRows();
  let currentState = null;
  if (rows.length > 0) {
    const r0 = rows[0];
    currentState = {
      status: r0.get("Status"),
      startTime: r0.get("Start Time"),
      duration: r0.get("Duration Minutes"),
      resultsPublished: String(r0.get("Results Published")) === "true",
      publishedAt: r0.get("Published At"),
    };
    console.log("Current competition state:", currentState);
  }

  let newRowData = {};
  let responseMessage = "";
  const responseData = { success: true, action, timestamp: now };

  if (action === "publish_results") {
    if (!currentState) return error(400, "No competition found. Please start a competition first.");
    if (currentState.resultsPublished) return error(400, "Results have already been published.");

    if (rows.length > 0) {
      const r0 = rows[0];
      r0.set("Results Published", "true");
      r0.set("Published At", now);
      r0.set("Notes", `${r0.get("Notes") || ""} | Results published at ${now}`.trim());
      await r0.save();

      responseMessage = "Results published successfully! Leaderboard unfrozen and gallery accessible.";
      responseData.resultsPublished = true;
      responseData.publishedAt = now;

      console.log("Results published successfully");
      return ok({ ...responseData, message: responseMessage });
    }
    return error(400, "No competition data found to publish results for.");
  }

  if (action === "reset") {
    await resetPenaltyData(doc);

    // Clear all rows
    for (const r of rows) await r.delete();

    newRowData = {
      "Status": "reset",
      "Start Time": "",
      "Duration Minutes": "",
      "Results Published": "false",
      "Published At": "",
      "Created At": now,
      "Action By": "Admin",
      "Notes": "Competition reset via admin panel",
    };
    await competitionSheet.addRow(newRowData);

    responseMessage = "Competition reset successfully";
    responseData.competitionStartTime = null;
    responseData.resultsPublished = false;

    return ok({ ...responseData, message: responseMessage });
  }

  // Handle start/stop
  // Determine start time if starting
  let startTime;
  if (action === "start") {
    startTime = customStartTime || now;
    if (customStartTime) {
      const d = new Date(customStartTime);
      if (Number.isNaN(d.getTime())) {
        return error(400, "Invalid custom start time format. Use ISO (e.g., 2025-01-01T10:00:00Z)");
      }
      startTime = d.toISOString();
    }
  }

  // Delete existing rows (your current behavior)
  for (const r of rows) await r.delete();

  // Preserve fields for stop
  let preservedStartTime = "";
  let preservedDuration = "";
  if (action === "stop" && currentState) {
    preservedStartTime = currentState.startTime || "";
    preservedDuration = currentState.duration || "";
    console.log("Preserving start time and duration for stop:", {
      startTime: preservedStartTime,
      duration: preservedDuration,
    });
  }

  newRowData = {
    "Status": action,
    "Start Time": action === "start" ? startTime : action === "stop" ? preservedStartTime : "",
    "Duration Minutes": action === "start" ? 90 : action === "stop" ? preservedDuration : "",
    "Results Published": "false",
    "Published At": "",
    "Created At": now,
    "Action By": "Admin",
    "Notes":
      action === "start"
        ? "Competition started via admin panel"
        : action === "stop"
        ? "Competition stopped via admin panel"
        : "Competition updated via admin panel",
  };

  console.log("Adding new competition status:", newRowData);
  await competitionSheet.addRow(newRowData);

  switch (action) {
    case "start":
      responseMessage = `Competition started successfully at ${newRowData["Start Time"]}`;
      responseData.competitionStartTime = newRowData["Start Time"];
      responseData.duration = 90;
      responseData.resultsPublished = false;
      break;
    case "stop":
      responseMessage = "Competition stopped successfully";
      responseData.competitionStartTime = preservedStartTime;
      responseData.duration = preservedDuration;
      responseData.resultsPublished = false;
      break;
    default:
      responseMessage = "Competition updated";
  }

  console.log("Competition action completed successfully");
  return ok({ ...responseData, message: responseMessage });
}

async function ensurePenaltyColumns(leaderboardSheet) {
  try {
    await leaderboardSheet.loadHeaderRow();
    const headers = leaderboardSheet.headerValues || [];
    const required = ["Status", "Penalty", "Return Time", "Penalty Minutes", "Locked"];
    const missing = required.filter((h) => !headers.includes(h));

    if (missing.length) {
      const newHeaders = [...headers, ...missing];
      await leaderboardSheet.setHeaderRow(newHeaders);

      const rows = await leaderboardSheet.getRows();
      console.log("Initializing penalty columns for", rows.length, "teams");

      for (const row of rows) {
        if (missing.includes("Status") && !row.get("Status")) row.set("Status", "active");
        if (missing.includes("Penalty") && !row.get("Penalty")) row.set("Penalty", "0");
        if (missing.includes("Return Time") && !row.get("Return Time")) row.set("Return Time", "");
        if (missing.includes("Penalty Minutes") && !row.get("Penalty Minutes")) row.set("Penalty Minutes", "0");
        if (missing.includes("Locked") && !row.get("Locked")) row.set("Locked", "FALSE");
        await row.save();
      }
      console.log("Penalty columns initialized successfully");
    } else {
      console.log("All penalty columns already exist");
    }
  } catch (e) {
    console.error("Error ensuring penalty columns:", e);
    throw e;
  }
}

async function resetPenaltyData(doc) {
  try {
    const leaderboardSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Leaderboard"] : null;
    if (!leaderboardSheet) return;

    await leaderboardSheet.loadHeaderRow();
    const rows = await leaderboardSheet.getRows();
    console.log("Resetting penalty data for", rows.length, "teams");

    for (const row of rows) {
      row.set("Status", "active");
      row.set("Penalty", "0");
      row.set("Return Time", "");
      row.set("Penalty Minutes", "0");
      row.set("Locked", "FALSE");
      await row.save();
    }
    console.log("Penalty data reset successfully");
  } catch (e) {
    console.error("Error resetting penalty data:", e);
    // non-fatal
  }
}
