export default function (text) {
  try {
    if (!text) return ''
  
    const cleanText = text.toString().replace(/\s+/g, '')

    if (cleanText.length <= 4) {
        return cleanText
    }

    return cleanText.match(/.{1,4}/g).join(' ')
  } catch (error) {
    console.error("Error formatting account number.")

    return "ERROR"
  }
}