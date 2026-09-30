--!nonstrict
-- Publishes the active BT audio profile via ~/.local/bin/bt-profile-set; performs manual toggles.

local MODE_KEY = "bt_call_profile_mode"
local SCRIPT = "/home/ivan/.local/bin/bt-profile-set"

local inFlight = false

local function publish(result)
	if result and result.stdout and result.stdout ~= "" then
		local out = tostring(result.stdout):gsub("%s+$", "")
		if out ~= "" then
			noctalia.state.set(MODE_KEY, out)
		end
	end
end

local function status()
	if inFlight then
		return
	end
	inFlight = true
	noctalia.runAsync(SCRIPT .. " status", function(result)
		inFlight = false
		publish(result)
	end)
end

function onIpc(event, payload)
	noctalia.log("[bt-call-profile] ipc event: " .. tostring(event))
	if event == "toggle" then
		noctalia.runAsync(SCRIPT .. " toggle", function(result)
			publish(result)
		end)
	elseif event == "resync" then
		status()
	end
end

status()
noctalia.setUpdateInterval(4000)

function update()
	status()
end
