const createProductModel = require('./productModel');
const createReviewModel = require('./reviewModel');

const createModels = (connection) => ({
    productModel: createProductModel(connection),
    reviewModel: createReviewModel(connection)
});

module.exports = createModels;
