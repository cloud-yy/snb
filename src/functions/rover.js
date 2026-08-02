import axios from "axios"

const BASE_URL = "https://registry.rover.link/api"
const GUILD_ID = process.env.DISCORD_GUILD_ID

export async function robloxFromDiscord (guidId = GUILD_ID, userId) {
    try {
        const response = await axios.get(`${BASE_URL}/guilds/${guidId}/discord-to-roblox/${userId}`, {
            headers: {
                Authorization: `Bearer ${process.env.ROVER_API_KEY}`
            }
        })
        
        return response.data
    } catch(error) {
        if (error.response) {
            console.error(`Request Error [${error.response.status}]:`, error.response.data.message || error.response.data);
        } else if (error.request) {
            console.error('Request Error: No response received.');
        } else {
            console.error('Request Error:', error.message);
        }
        
        return null;
    }
}

export async function discordFromRoblox (guidId = GUILD_ID, userId) {
    try {
        const response = await axios.get(`${BASE_URL}/guilds/${guidId}/roblox-to-discord/${userId}`, {
            headers: {
                Authorization: `Bearer ${process.env.ROVER_API_KEY}`
            }
        })
        
        return response.data
    } catch (error) {
        if (error.response) {
            console.error(`Request Error [${error.response.status}]:`, error.response.data.message || error.response.data);
        } else if (error.request) {
            console.error('Request Error: No response received.');
        } else {
            console.error('Request Error:', error.message);
        }
        
        return null; 
    }
}

export async function accessRequest (guidId = GUILD_ID, userId) {
    try {
        const response = await axios.get(`${BASE_URL}/guilds/${guidId}/access-requests/${userId}`, {
            headers: {
                Authorization: `Bearer ${process.env.ROVER_API_KEY}`
            }
        })
        
        return response.data
    } catch (error) {
        if (error.response) {
            console.error(`Request Error [${error.response.status}]:`, error.response.data.message || error.response.data);
        } else if (error.request) {
            console.error('Request Error: No response received.');
        } else {
            console.error('Request Error:', error.message);
        }
        
        return null; 
    }
}