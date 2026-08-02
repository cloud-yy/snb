document.addEventListener("DOMContentLoaded", async () => {
    try {
        const response = await fetch("head.html");
        const data = await response.text();
        document.head.innerHTML += data;
    } catch (error) {
        console.error("Error loading head:", error);
    }
});