const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

const db = admin.firestore();

exports.onBookingStatusChange = functions.firestore
    .document('bookings/{bookingId}')
    .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (before.status !== 'finished' && after.status === 'finished') {
        const bookingId = context.params.bookingId;
        const totalBookingAmount = after.totalBookingAmount;
        const gstDetails = calculateGst(totalBookingAmount);
        await db.collection('bookings').doc(bookingId).update({
            gstDetails,
        });
        const gstResponse = await fileGstWithApi(after.name, totalBookingAmount, gstDetails);

        if (gstResponse.success) {
            await db.collection('bookings').doc(bookingId).update({
                'gstDetails.filed': true,
            });
        }
    }
});

const calculateGst = (totalAmount) => {
    const gstRate = 0.18;
    const totalGst = totalAmount * gstRate;
    const cgst = totalGst / 2;
    const sgst = totalGst / 2;
    const igst = totalGst;
    return { igst, cgst, sgst, totalGst };
}

const fileGstWithApi = async (name, totalBookingAmount, gstDetails) => {
    try {
        const apiEndpoint = functions.config().gst.api_endpoint;

        const response = await axios.post(apiEndpoint, {
            name,
            totalBookingAmount,
            gstDetails
        })

        return { success: true, data: response.data };
    } catch (error) {
        return { success: false, error };
    }
}

exports.autoUpdateStatus = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
    const bookings = await db.collection('bookings').where('status', '==', 'pending').get();

    const promises = bookings.docs.map(doc => {
        return doc.ref.update({ status: 'finished' });
    });
    await Promise.all(promises);
    console.log('Updated status for all pending bookings');
});