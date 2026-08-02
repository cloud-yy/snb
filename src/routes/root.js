import { Router } from "express"
import path from "path"

const router = Router()

router.get("/", async (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
})

export default router