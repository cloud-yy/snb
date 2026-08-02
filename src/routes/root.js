import { Router } from "express"

const router = Router()

router.get("/", async (req, res) => {
    res.sendStatus(418)
})

export default router