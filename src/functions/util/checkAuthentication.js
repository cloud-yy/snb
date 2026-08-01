export default async function (req) {
    const key = req.get("api-key")

    if (!key) {
        return false
    }

    if (key !== process.env.AUTH) {
        return false
    }

    return true
}