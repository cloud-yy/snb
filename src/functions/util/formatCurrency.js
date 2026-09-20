export default function formatCurrency(amount, decimals = 2, locale = 'en-GB') {
    return new Intl.NumberFormat(locale, {
        style: "decimal",

        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(amount)
}