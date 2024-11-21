const db = require('../config/db');

const User = {
    async create({ name, email, username, password, phone, address, paymentInfo }) {
        const [result] = await db.execute(
            'INSERT INTO users (name, email, username, password, phone, address, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, email, username, password, phone, address, paymentInfo]
        );
        return result.insertId;
    },
    async findByUsername(username) {
        const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
        return rows[0];
    },
};

module.exports = User;
