import crypto from "node:crypto"

const ROVER_API_KEY = process.env.ROVER_API_KEY

export default async function (headers, rawBody) {
  try {
    const secret = crypto.createHash("sha256").update(ROVER_API_KEY).digest("hex")

    const data = `${headers["x-rover-timestamp"]}.${rawBody}`
    const expected =
        "sha256=" + crypto.createHmac("sha256", secret).update(data).digest("hex")

    return expected === headers["x-rover-signature"]
  } catch (error) {
    console.error(error)
    
    return false
  }
}