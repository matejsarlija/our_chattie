const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY); // Add this to your .env file

async function sendUpdateEmail({ to, searchTerm, caseInfo, analysis, unsubscribeToken }) {
    const unsubscribeLink = `https://your-app-domain.onrender.com/api/unsubscribe/${unsubscribeToken}`;

    const msg = {
        to: to,
        from: 'admin@alimentacija.info', // MUST be a verified sender in SendGrid
        subject: `Nova objava za Vašu pretragu: ${searchTerm}`,
        html: `
            <h1>Pronađena je nova sudska objava!</h1>
            <p>Pronašli smo novu objavu za pojam koji pratite: <strong>${searchTerm}</strong></p>
            <hr>
            <h2>Detalji objave:</h2>
            <p><strong>Naziv:</strong> ${caseInfo.title}</p>
            <p><strong>Broj predmeta:</strong> ${caseInfo.caseNumber}</p>
            <p><strong>Sud:</strong> ${caseInfo.court}</p>
            <p><strong>Datum objave:</strong> ${caseInfo.date}</p>
            <hr>
            <h2>AI Analiza:</h2>
            <div style="white-space: pre-wrap; background-color: #f5f5f5; padding: 15px; border-radius: 5px;">${analysis}</div>
            <br>
            <p><a href="${caseInfo.detailLink}">Pogledajte originalnu objavu na e-Oglasnoj ploči</a></p>
            <br><br>
            <hr>
            <p style="font-size: 12px; color: #888;">
                Ne želite više primati ove obavijesti? <a href="${unsubscribeLink}">Odjavite se</a>.
            </p>
        `,
    };

    try {
        await sgMail.send(msg);
        console.log(`Update email successfully sent to ${to}`);
    } catch (error) {
        console.error('Error sending email with SendGrid:', error);
        if (error.response) {
            console.error(error.response.body)
        }
        throw error; // Re-throw to be caught by the cron job loop
    }
}

module.exports = { sendUpdateEmail };