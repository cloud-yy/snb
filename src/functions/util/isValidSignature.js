import crypto from "node:crypto"

const roverKeys = fetch(
  "https://registry.rover.link/.well-known/jwks.json",
)
  .then((response) => response.json())
  .then(({ keys }) =>
    keys.map((key) => crypto.createPublicKey({ key, format: "jwk" })),
  )

export default async function (request) {
  const id = request.headers.get("webhook-id")
  const timestamp = request.headers.get("webhook-timestamp")
  const signatures = request.headers.get("webhook-signature")
  if (!id || !timestamp || !signatures) throw new Error("Missing headers")

  const sentAt = Number(timestamp)
  if (!Number.isInteger(sentAt) || Math.abs(Date.now() / 1000 - sentAt) > 300) {
    throw new Error("Stale webhook")
  }

  const body = Buffer.from(await request.arrayBuffer())
  const message = Buffer.concat([
    Buffer.from(`${id}.${timestamp}.`),
    body,
  ])
  const keys = await roverKeys
  const valid = signatures.split(" ").some(
    (value) =>
      value.startsWith("v1a,") &&
      keys.some((key) =>
        crypto.verify(
          null,
          message,
          key,
          Buffer.from(value.slice(4), "base64"),
        ),
      ),
  )

  if (!valid) throw new Error("Invalid signature")
  return JSON.parse(body.toString("utf8"))
}