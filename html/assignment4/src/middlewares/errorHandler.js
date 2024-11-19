// errorHandler.js
module.exports = {
    notFound: (req, res, next) => {
        res.status(404).json({ message: 'Resource not found' });
    },

    errorHandler: (err, req, res, next) => {
        console.error(err.stack);
        res.status(err.status || 500).json({
            message: err.message || 'Internal Server Error',
        });
    },
};
