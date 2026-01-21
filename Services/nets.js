exports.generateQrCode = async (req, res) => {
  const { cartTotal } = req.body;
  console.log(cartTotal);
  try {
    const requestBody = {
      txn_id: "sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b", // Default for testing
      amt_in_dollars: cartTotal,
      notify_mobile: 0,
    };

    const response = await fetch(
      `https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/request`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": process.env.API_KEY,
          "project-id": process.env.PROJECT_ID,
        },
        body: JSON.stringify(requestBody),
      }
    );

    const responseData = await response.json();

    if (!response.ok || !responseData?.result?.data) {
      console.error("NETS API error:", response.status, responseData);
      return res.render("netsQrFail", {
        title: "Error",
        user: req.session?.user,
        responseCode: responseData?.code || responseData?.result?.code || response.status || "N.A.",
        instructions: responseData?.message || responseData?.result?.message || "",
        errorMsg: "Unable to generate NETS QR. Check API credentials and request payload."
      });
    }

    const getCourseInitIdParam = () => {
      try {
        require.resolve("./../course_init_id");
        const { courseInitId } = require("../course_init_id");
        console.log("Loaded courseInitId:", courseInitId);

        return courseInitId ? `${courseInitId}` : "";
      } catch (error) {
        return "";
      }
    };

    const qrData = responseData.result.data;
    console.log({ qrData });

    if (qrData.response_code === "00" && qrData.txn_status === 1 && qrData.qr_code) {
      console.log("QR code generated successfully");

      // Store transaction retrieval reference for later use
      const txnRetrievalRef = qrData.txn_retrieval_ref;
      const courseInitId = getCourseInitIdParam();

      const webhookUrl = `https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets/webhook?txn_retrieval_ref=${txnRetrievalRef}&course_init_id=${courseInitId}`;

      console.log("Transaction retrieval ref:" + txnRetrievalRef);
      console.log("courseInitId:" + courseInitId);
      console.log("webhookUrl:" + webhookUrl);

      
      // Render the QR code page with required data
      res.render("netsQr", {
        total: cartTotal,
        title: "Scan to Pay",
        qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
        user: req.session?.user,
        txnRetrievalRef: txnRetrievalRef,
        courseInitId: courseInitId,
        networkCode: qrData.network_status,
        timer: 300, // Timer in seconds
        webhookUrl: webhookUrl,
         fullNetsResponse: responseData,
        apiKey: process.env.API_KEY,
        projectId: process.env.PROJECT_ID,
      });
    }

    // Handle partial or failed responses
    let errorMsg = "An error occurred while generating the QR code.";
    if (qrData.network_status !== 0) {
      errorMsg = qrData.error_message || "Transaction failed. Please try again.";
    }
    res.render("netsQrFail", {
      title: "Error",
      user: req.session?.user,
      responseCode: qrData.response_code || "N.A.",
      instructions: qrData.instruction || "",
      errorMsg: errorMsg,
    });
  } catch (error) {
    console.error("Error in generateQrCode:", error.message);
    res.render("netsQrFail", {
      title: "Error",
      user: req.session?.user,
      responseCode: "N.A.",
      instructions: "",
      errorMsg: "Unable to generate NETS QR at the moment. Please try again."
    });
  }
};
