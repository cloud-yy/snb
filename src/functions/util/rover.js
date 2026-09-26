import axios from "axios"
import rateLimit from 'axios-rate-limit';
import config from "#config" with { type: "json" }

const BASE_URL = "https://registry.rover.link/api"
const GUILD_ID = process.env.DISCORD_GUILD_ID

const roverClient = axios.create({
    baseURL: "https://registry.rover.link/api",
    headers: {
        "Authorization": `Bearer ${process.env.ROVER_API_KEY}`,
        "Content-Type": "application/json"
    }
})

const api = rateLimit(roverClient, {
  maxRequests: 4,
  perMilliseconds: 10000
});

export async function robloxFromDiscord (userId, guidId = GUILD_ID) {
    try {
        const response = await api.get(`/guilds/${guidId}/discord-to-roblox/${userId}`)
        
        return response.data
    } catch (error) {
        if (error.response) {
            console.error(`Request Error [${error.response.status}]:`, error.response.data.message || error.response.data);
        } else if (error.request) {
            console.error("Request Error: No response received.");
        } else {
            console.error("Request Error:", error.message);
        }
        
        return null;
    }
}

export async function discordFromRoblox (userId, guidId = GUILD_ID) {
    try {
        const response = await api.get(`/guilds/${guidId}/roblox-to-discord/${userId}`)
        
        return response.data
    } catch (error) {
        if (error.response) {
            console.error(`Request Error [${error.response.status}]:`, error.response.data.message || error.response.data);
        } else if (error.request) {
            console.error("Request Error: No response received.");
        } else {
            console.error("Request Error:", error.message);
        }

        return null; 
    }
}

export async function accessRequest (userId, guidId = GUILD_ID) {
    try {
        const response = await api.put(`/guilds/${guidId}/access-requests/${userId}`,
            { "callbackUrl": `${config.domain.replace(/\/$/, "")}/rover/consent` })
        
        return response.data
    } catch (error) {
        if (error.response) {
            console.error(`Request Error [${error.response.status}]:`, error.response.data.message || error.response.data);
        } else if (error.request) {
            console.error("Request Error: No response received.");
        } else {
            console.error("Request Error:", error.message);
        }
        
        return null; 
    }
}
