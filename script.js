let tableData = [];
let timer;
let statusUpdateInterval;

function getValidStoredUserInfo() {
    const storedTimestampStr = localStorage.getItem('userInfoTimestamp');
    let storedName = null;
    let storedLevel = null;

    if (storedTimestampStr) {
        const storedTimestamp = parseInt(storedTimestampStr);
        const oneHourInMillis = 60 * 60 * 1000;
        const currentTime = Date.now();

        if (currentTime - storedTimestamp < oneHourInMillis) {
            storedName = localStorage.getItem('userName');
            const storedLevelStr = localStorage.getItem('userLevel');
            if (storedLevelStr) {
                storedLevel = parseInt(storedLevelStr);
            }
        } else {
            localStorage.removeItem('userName');
            localStorage.removeItem('userLevel');
            localStorage.removeItem('userInfoTimestamp');
            localStorage.removeItem('welcomeMessageShown');
            console.log("Stored user info expired and removed.");
        }
    }
    return { name: storedName, level: storedLevel };
}


async function loadListNames() {
  try {
    const data = LIST_DATA;
    const listSelect = document.getElementById("list-select");
    for (const listName in data) {
      const option = document.createElement("option");
      option.value = listName;
      option.textContent = listName;
      listSelect.appendChild(option);
    }
  } catch (error) {
    console.error("Error loading list names:", error);
  }
}

async function fetchData() {
    const apiKey = document.getElementById("api-key").value;

    const listSelectForError = document.getElementById("list-select");
    const selectedListForError = listSelectForError.value || 'None Selected';
    const validStoredInfo = getValidStoredUserInfo();

    if (apiKey === "") {
        alert("Please enter an API key");
        errorLogly(validStoredInfo.name, validStoredInfo.level, "API key was missing", selectedListForError);
        return;
    }

    localStorage.setItem("apiKey", apiKey);

    const listSelect = document.getElementById("list-select");
    const selectedList = listSelect.value;

    if (!selectedList) {
        alert("Please select a list.");
        errorLogly(validStoredInfo.name, validStoredInfo.level, "No list selected", 'None Selected');
        return;
    }


    const fetchButton = document.getElementById("fetch-button");
    fetchButton.disabled = true;
    startCountdown();

    const tableBody = document.getElementById("table-body");
    tableBody.innerHTML = "";

    showLoadingIndicator();
    hideDataTable();

    let currentFetchUserName = null;
    let currentFetchUserLevel = null;
    let fetchError = null;

    let welcomeMessageShown = localStorage.getItem('welcomeMessageShown') === 'true';

    try {

        let fetchUserInfoAttempted = false;

         if (apiKey.length >= 10) {
             fetchUserInfoAttempted = true;
             try {
                const userCheckUrl = `https://api.torn.com/user/?selections=basic&key=${apiKey}`;
                const userCheckResponse = await fetch(userCheckUrl);
                const userCheckData = await userCheckResponse.json();

                if (userCheckData.error) {
                    console.error("Error fetching user data:", userCheckData.error.error);
                    fetchError = `User info fetch failed: ${userCheckData.error.error}`;
                } else {
                    currentFetchUserName = userCheckData.name;
                    currentFetchUserLevel = userCheckData.level;

                    localStorage.setItem('userName', currentFetchUserName);
                    localStorage.setItem('userLevel', currentFetchUserLevel.toString());
                    localStorage.setItem('userInfoTimestamp', Date.now().toString());

                    if (!welcomeMessageShown) {
                        showCustomPopup(`Happy Halloween ${currentFetchUserName}! Go get 'em.`);
                        localStorage.setItem('welcomeMessageShown', 'true');
                    }
                }
            } catch (error) {
                console.error("Network error fetching user data:", error);
                fetchError = `User info fetch network error: ${error.message}`;
            }
        }


        tableData = LIST_DATA[selectedList];

        if (!tableData || tableData.length === 0) {
            displayNoDataMessage();
            hideLoadingIndicator();
            if (!fetchError) fetchError = `No data found for list: ${selectedList}`;
            return;
        }


        const userPromises = tableData.map(async (row) => {
            const apiUrl = `https://api.torn.com/user/${row.id}?selections=basic&key=${apiKey}`;
            try {
                const userResponse = await fetch(apiUrl);
                const userData = await userResponse.json();

                if (userData.error) {
                     console.error(`Error fetching data for user ${row.id}:`, userData.error.error);
                     if (userData.error.code === 2 && !fetchError) {
                        fetchError = `Invalid API Key used for target fetch (Code ${userData.error.code})`;
                     } else if (!fetchError) {
                         fetchError = `Target fetch error for ${row.id}: ${userData.error.error} (Code ${userData.error.code})`;
                     }
                     return { ...row, status: `Error (${userData.error.code})` };
                }

                const status = formatStatus(userData.status);
                return { ...row, status };
            } catch (error) {
                console.error(`Network error fetching data for user ${row.id}:`, error);
                 if (!fetchError) fetchError = `Network error during target fetch for ${row.id}: ${error.message}`;
                return { ...row, status: "Network Error" };
            }
        });

        const usersWithStatus = await Promise.all(userPromises);


        // Attackable targets first (weakest estimated stats first), then hospitalized
        // (shortest timer first), then anything else (travelling, jail, federal...) by stats.
        const statusRank = (s) => s === "Okay" ? 0 : parseHospitalTime(s) !== Infinity ? 1 : 2;
        const sortedUsers = usersWithStatus.sort((a, b) => {
            const rank = statusRank(a.status) - statusRank(b.status);
            if (rank !== 0) return rank;
            if (statusRank(a.status) === 1) return parseHospitalTime(a.status) - parseHospitalTime(b.status);
            return parseStats(a.est) - parseStats(b.est);
        });

        sortedUsers.forEach((user, index) => {
            const attackLink = createAttackLink(user.id, user.status);
            const newRow = createTableRow(user, user.status, attackLink, index);
            tableBody.innerHTML += newRow;
        });

        hideNoDataMessage();
        displayDataTable();

        clearInterval(statusUpdateInterval);
        statusUpdateInterval = setInterval(() => {
            updateStatus();
        }, 1000);

    } catch (error) {
        console.error("Error fetching list data:", error);
         if (!fetchError) fetchError = `Main list data fetch error: ${error.message}`;
        displayNoDataMessage();
    } finally {
        hideLoadingIndicator();

        const finalStoredInfo = getValidStoredUserInfo();

        const finalName = currentFetchUserName || finalStoredInfo.name || null;
        const finalLevel = currentFetchUserLevel !== null ? currentFetchUserLevel : finalStoredInfo.level;
        const finalError = fetchError || null;

        errorLogly(finalName, finalLevel, finalError, selectedList);
    }
}

function startCountdown() {
  const fetchButton = document.getElementById("fetch-button");
  const startTime = Date.now();
  const countdownSeconds = 30;

  clearInterval(timer);
  timer = setInterval(() => {
    const secondsSinceStart = Math.floor((Date.now() - startTime) / 1000);
    const remainingTime = countdownSeconds - secondsSinceStart;

    if (remainingTime <= 0) {
      clearInterval(timer);
      fetchButton.textContent = "FETCH";
      fetchButton.disabled = false;
    } else {
      fetchButton.textContent = `FETCH (${remainingTime}s)`;
    }
  }, 1000);
}

// "7.69k" -> 7690, "1.6b" -> 1600000000. Unknown/blank sorts last.
function parseStats(est) {
  const m = String(est || "").trim().match(/^([\d.]+)\s*([kmbt]?)/i);
  if (!m) return Infinity;
  const mult = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2].toLowerCase()];
  return parseFloat(m[1]) * mult;
}

function parseHospitalTime(status) {
  const timeMatch = status.match(/\((\d+)m (\d+)s\)/);
  if (!timeMatch) return Infinity;
  const [_, minutes, seconds] = timeMatch;
  return parseInt(minutes) * 60 + parseInt(seconds);
}

function displayNoDataMessage() {
  const noDataMessage = document.getElementById("no-data-message");
  noDataMessage.classList.remove("hidden");

  const dataTable = document.getElementById("data-table");
  dataTable.classList.add("hidden");

  const apiMessage = document.getElementById("api-message");
  apiMessage.classList.add("hidden");
}

function hideNoDataMessage() {
  const noDataMessage = document.getElementById("no-data-message");
  noDataMessage.classList.add("hidden");
}

function displayDataTable() {
  const dataTable = document.getElementById("data-table");
  dataTable.classList.remove("hidden");

  const apiMessage = document.getElementById("api-message");
  apiMessage.classList.add("hidden");
}

function formatStatus(status) {
  let formattedStatus = status.state;
  if (formattedStatus === "Hospital") {
    const remaining = status.until - Date.now() / 1000;
    if (remaining > 0) {
        const minutes = Math.floor(remaining / 60);
        const seconds = Math.floor(remaining % 60);
        formattedStatus = `Hospitalized (${minutes}m ${seconds}s)`;
    } else {
        formattedStatus = "Okay";
    }
  }
  return formattedStatus;
}

function updateStatus() {
  const rows = document.querySelectorAll("#table-body tr");
  rows.forEach((row) => {
    const statusCell = row.querySelector("td:nth-child(4)");
    if (!statusCell) return;

    const currentStatus = statusCell.textContent.trim();
    const remaining = parseHospitalTime(currentStatus);

    if (remaining === Infinity) return;

    const updatedRemaining = remaining - 1;

    if (updatedRemaining <= 0) {
      statusCell.textContent = "Okay";
      statusCell.className = statusClass("Okay");
      const profileLink = row.querySelector("td:first-child a[href*='XID']");
      if (profileLink) {
          const userIdMatch = profileLink.href.match(/XID=(\d+)/);
           if (userIdMatch && userIdMatch[1]) {
                const userId = userIdMatch[1];
                const attackLinkCell = row.querySelector("td:nth-child(5)");
                if (attackLinkCell) {
                   attackLinkCell.innerHTML = createAttackLink(userId, "Okay");
                }
           }
      }
    } else {
      const updatedMinutes = Math.floor(updatedRemaining / 60);
      const updatedSeconds = updatedRemaining % 60;
      statusCell.textContent = `Hospitalized (${updatedMinutes}m ${updatedSeconds}s)`;
    }
  });
}

function showLoadingIndicator() {
  const loadingIndicator = document.getElementById("loading-indicator");
  loadingIndicator.classList.remove("hidden");
}

function hideLoadingIndicator() {
  const loadingIndicator = document.getElementById("loading-indicator");
  loadingIndicator.classList.add("hidden");
}

function hideDataTable() {
  const dataTable = document.getElementById("data-table");
  dataTable.classList.add("hidden");
}

function highlightRow(button) {
  document.querySelectorAll("#table-body tr.selected").forEach(row => {
    row.classList.remove("selected");
  });

  const row = button.closest("tr");
  if (row) {
    row.classList.add("selected");
  }
}

function createAttackLink(id, status) {
  const isDisabled = status !== "Okay";
  const disabledClass = isDisabled ? "disabled" : "";
  const onClick = isDisabled ? "event.preventDefault();" : "highlightRow(this)";

  return `<a target="_blank" href="https://www.torn.com/page.php?sid=attack&user2ID=${id}" class="btn attack ${disabledClass}" onclick="${onClick}">ATTACK</a>`;
}

function populateAPIKey() {
  const urlParams = new URLSearchParams(window.location.search);
  const apiKey = urlParams.get('apiKey');
  if (apiKey) {
    document.getElementById("api-key").value = apiKey;
    localStorage.setItem("apiKey", apiKey);
  } else {
    const storedApiKey = localStorage.getItem("apiKey");
    if (storedApiKey)
      document.getElementById("api-key").value = storedApiKey;
  }
}

function statusClass(status) {
  return status === "Okay" ? "status-okay" : "status-other";
}

function createTableRow(row, status, attackLink, index) {
  return `
    <tr>
      <td class="player">
        <a href="https://www.torn.com/profiles.php?XID=${row.id}" target="_blank">
          ${row.name}<span class="pid">[${row.id}]</span>
        </a>
        <div class="mobile-meta">Level ${row.lvl} &middot; Est. ${row.est}</div>
      </td>
      <td class="col-lvl">${row.lvl}</td>
      <td class="col-est">${row.est}</td>
      <td class="${statusClass(status)}">${status}</td>
      <td class="attack-cell">${attackLink}</td>
    </tr>
  `;
}

function showCustomPopup(message) {
    const overlay = document.getElementById('custom-popup-overlay');
    const messageElement = document.getElementById('custom-popup-message');
    const closeButton = document.getElementById('custom-popup-close');

    if (!overlay || !messageElement || !closeButton) {
        console.error("Popup elements not found in the DOM. Falling back to alert.");
        alert(message);
        return;
    }

    messageElement.textContent = message;
    overlay.classList.remove('hidden');

    closeButton.onclick = () => {
        overlay.classList.add('hidden');
    };

    overlay.onclick = (event) => {
        if (event.target === overlay) {
             overlay.classList.add('hidden');
        }
    };
}


// Original site POSTed usage/errors to oran.pw; disabled so nothing leaves the browser except Torn API calls.
function errorLogly(name, level, error, listName) {
    if (error) console.warn(`[${listName}] ${error}`);
}

document.addEventListener("DOMContentLoaded", () => {
    populateAPIKey();
    loadListNames();
});
