function widget:GetInfo()
	return {
		name         = "Statistics logger",
		desc         = "Performs some statistics functions to log things",
		author       = "jorisvddonk",
		date         = "2024-09-21",
		layer        = 0,
		enabled      = true
	}
end

local UnitDefs = UnitDefs
local file
local flog
local frameNum = 0
local active = false
local modOptions

function list_accessible_functions(max_depth)
    max_depth = max_depth or 3
    local visited = {}
    local function_list = {}
    local counter = 0

    -- Get environment using Spring's method
    local env = _G or getfenv(2)  -- Try different environment access methods
    
    -- Fallback: Use debug library if available
    if not env and debug and debug.getupvalue then
        local i = 1
        while true do
            local name, value = debug.getupvalue(2, i)
            if not name then break end
            if name == "_ENV" or name == "_G" then
                env = value
                break
            end
            i = i + 1
        end
    end

    -- Final fallback: Use widget table
    env = env or widget or {}

    -- Recursive traversal function
    local function traverse(t, path, depth)
        if depth > max_depth or type(t) ~= "table" or visited[t] then return end
        
        -- Track visited tables
        counter = counter + 1
        visited[t] = counter
        
        for key, value in pairs(t) do
            if type(key) == "string" then
                local new_path = path and (path .. "." .. key) or key
                
                if type(value) == "function" then
                    table.insert(function_list, new_path)
                elseif type(value) == "table" and not visited[value] then
                    traverse(value, new_path, depth + 1)
                end
            end
        end
    end

    traverse(env, nil, 0)
    table.sort(function_list)
    return function_list
end

local replay_info = {}
local tcp
function SetupSocket()
    -- Create a TCP socket
    tcp = socket.tcp()
    if not tcp then
        log("<Statistics logger> Failed to create TCP socket")
        return
    end

    -- Set timeout (in seconds)
    tcp:settimeout(5)

    -- Connect to a server
    -- Replace with your actual server IP and port
    local host = replay_info.replay_info_host
    local port = replay_info.replay_info_port
    
    log("<Statistics logger> Attempting to connect to " .. host .. ":" .. port)
    local success, err = tcp:connect(host, port)
    
    if not success then
        log("<Statistics logger> Connection failed: " .. err)
        tcp:close()
        return
    end

    log("<Statistics logger> Connection established!")
    
    -- Send a message
    local message = "# Hello from Beyond All Reason! This is replay with id: " .. replay_info.id .. "\n"
    local bytes_sent, send_err = tcp:send(message)
    
    if not bytes_sent then
        log("<Statistics logger> Send failed: " .. send_err)
    else
        log("<Statistics logger> Sent " .. bytes_sent .. " bytes")
    end

    -- Optionally receive a response
    --local response, recv_err = tcp:receive("*l")  -- Read a line
    --if not response then
    --    log("<Statistics logger> Receive failed: " .. (recv_err or "unknown error"))
    --else
    --    log("<Statistics logger> Received response: " .. response)
    --end

    -- Close the connection
end

function TeardownSocket()
    if not tcp then
        Spring.Echo("No TCP socket to close")
        return
    end
    tcp:close()
    Spring.Echo("Connection closed")
end

local function isSpectator()
	local _, _, spectator = Spring.GetPlayerInfo(Spring.GetMyPlayerID(), false)

	if spectator then
		return true
    else
	    return false
    end
end

local function setReplaySpeed (speed, i)
	local s = Spring.GetGameSpeed()
	if (speed > s) then	--speedup
		Spring.SendCommands ("setminspeed " .. speed)
		Spring.SendCommands ("setminspeed " .. 0.1)
	else	--slowdown
		Spring.SendCommands ("setmaxspeed " .. speed)
		Spring.SendCommands ("setmaxspeed " .. 9999.0)
	end
end

function log(s)
    Spring.Echo(s)
    if not flog then
        return
    end
    flog:write(s .. "\n")
    flog:flush()
end

function widget:Initialize()
    startscript = VFS.LoadFile("_script.txt")
    Spring.Echo(startscript)
    Spring.Echo(Game.modName)
    Spring.Echo(Game.modDesc)
    local a, b, c, d = Spring.GetPlayerInfo(Spring.GetMyPlayerID(), false)
    Spring.Echo(a)
    Spring.Echo(b)
    Spring.Echo(c)
    Spring.Echo(d)
    if (Spring.GetConfigInt('Headless', 0) == 1 and isSpectator()) then
        active = true
        flog = io.open("stats.log", "w")
        file = io.open("stats.csv", "w")
        log("<Statistics logger> Initializing")
        log("<Statistics logger> We are headless and spectating a replay!")
        VFS.Include("replay_info.lua", replay_info) -- load the replay info
        log("<Statistics logger> Replay info loaded")
        file:write("frameNum,status,unitID,unitDefID,unitTeam,unitName\n")
        file:flush()
        local all_functions = list_accessible_functions(4)  -- Adjust depth as needed
        log("<Statistics logger> Accessible functions:")
        for _, func_name in ipairs(all_functions) do
            log(func_name)
        end

        -- Call the function to test (you might want to trigger this via a keypress or event)
        log("<Statistics logger> Setting up socket connection")
        SetupSocket()

        log("<Statistics logger> Setting replay speed")
        setReplaySpeed(9999.0)

        log("<Statistics logger> Sending initial HELLO message")
        sendToSocket("HELLO," .. replay_info.id .. "\n")

        log("<Statistics logger> Sending INFO message containing all available replay info")
        sendToSocket("INFO," .. replay_info.id .. "," .. replay_info.replay_info_raw_json .. "\n")
    else
        Spring.Echo("<Statistics logger> We are not headless; removing statistics logger widget!")
        widgetHandler:RemoveWidget()
    end
end

function widget:GameFrame(frame)  
    frameNum = frame
    if (replay_info.replay_info_send_stats_frames >= 0 and frameNum % replay_info.replay_info_send_stats_frames == 0) then
        -- send per-player stats in the format: frameNum,'playerStats',playerID,teamID,allyTeamID,metalIncomePerSecond,energyIncomePerSecond,metalStored,energyStored,activeUnits,unitsDied,unitsKilled,unitsCaptured,damageDealt,damageReceived
        for playerID = 0, 255 do
            local playerName, active, spectator, teamID, allyTeamID, pingTime, cpuUsage, country, rank, customPlayerKeys = Spring.GetPlayerInfo(playerID)
            if playerName and not spectator then
                local metalIncome, energyIncome, metalStored, energyStored = Spring.GetTeamResources(teamID, "metal")
                local activeUnits = Spring.GetTeamUnitCount(teamID) or 0
                local unitsKilled, unitsDied, unitsCapturedBy, unitsCapturedFrom, unitsReceived, unitsSent = Spring.GetTeamUnitStats(teamID)
                local damageDealt, damageReceived = Spring.GetTeamDamageStats(teamID)
                local maxUnits, currentUnits = Spring.GetTeamMaxUnits(teamID)

                local playerStats = string.format("%d,playerStats,%d,%d,%d,%f,%f,%f,%f,%d,%d,%d,%d,%f,%f\n",
                    frameNum, playerID, teamID, allyTeamID, metalIncome, energyIncome, metalStored, energyStored,
                    activeUnits, unitsDied, unitsKilled, unitsCapturedBy, damageDealt, damageReceived)
                sendStat(playerStats, true, "PLAYERSTATS")
            end
        end
    end
end

function widget:Shutdown()
    if (active) then
        log("<Statistics logger> Shutting down")
        log("<Statistics logger> Sending BYE message")
        sendToSocket("BYE," .. replay_info.id .. "\n")
        log("<Statistics logger> Closing socket connection")
        TeardownSocket()
        log("<Statistics logger> Flushing and closing files")
        file:flush()
        file:close()
        flog:flush()
        flog:close()
        Spring.Quit()
    end
end

function sendToSocket(message)
    if not tcp then
        --log("<Statistics logger> No TCP socket available to send message")
        return
    end

    local bytes_sent, send_err = tcp:send(message)
    if not bytes_sent then
        log("<Statistics logger> Send failed: " .. send_err)
    else
        log("<Statistics logger> Sent " .. bytes_sent .. " bytes: " .. message)
    end
end

function sendStat(message, socketOnly, prefix)
    if not socketOnly then
        file:write(message)
        file:flush()
    end
    sendToSocket(prefix .. "," .. replay_info.id .. "," .. message)
end

function widget:UnitCreated(unitID, unitDefID, unitTeam)
    --log("Found a new unit: " .. unitID  .. " - " .. unitDefID .. " -- " .. UnitDefs[unitDefID].name)
    sendStat(frameNum .. ",created," .. unitID  .. "," .. unitDefID .. "," .. unitTeam .. "," .. UnitDefs[unitDefID].name .. "\n", false, "UNITINFO")
end

function widget:UnitFinished(unitID, unitDefID, unitTeam)
    --log("Found a new unit: " .. unitID  .. " - " .. unitDefID .. " -- " .. UnitDefs[unitDefID].name)
    sendStat(frameNum .. ",finished," .. unitID  .. "," .. unitDefID .. "," .. unitTeam .. "," .. UnitDefs[unitDefID].name .. "\n", false, "UNITINFO")
end

function widget:UnitDestroyed(unitID, unitDefID, unitTeam, attackerID, attackerDefID, attackerTeam)
    --log("Unit destroyed" .. unitID  .. " - " .. unitDefID .. " -- " .. UnitDefs[unitDefID].name)
    sendStat(frameNum .. ",destroyed," .. unitID  .. "," .. unitDefID .. "," .. unitTeam .. "," .. UnitDefs[unitDefID].name .. "\n", false, "UNITINFO")
end

function widget:Update()
end
