export default function (blocks = 4) {
    const parts = []

    for (let i = 0; i < blocks; i++) {
        let num = Math.floor(Math.random() * 10000)
        
        let blockStr = num.toString().padStart(4, '0')
        
        if (i === 0) {
            blockStr = '1' + blockStr.substring(1)
        }
        
        parts.push(blockStr)
    }

    return parts.join("")
}