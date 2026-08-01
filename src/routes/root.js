import { Router } from 'express'

const router = Router()

router.get("/",(req, res) => {
    res.sendStatus(418)
})

export default router