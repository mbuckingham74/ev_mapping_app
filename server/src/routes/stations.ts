import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// Get all stations
router.get('/', async (req, res) => {
  try {
    const { state } = req.query;

    let query = 'SELECT * FROM stations';
    const params: string[] = [];

    if (state) {
      query += ' WHERE state = $1';
      params.push(state as string);
    }

    query += ' ORDER BY state, city';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching stations:', error);
    res.status(500).json({ error: 'Failed to fetch stations' });
  }
});

// Get station by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM stations WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Station not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching station:', error);
    res.status(500).json({ error: 'Failed to fetch station' });
  }
});

// Get stations near a location
router.get('/near/:lat/:lng', async (req, res) => {
  try {
    const { lat, lng } = req.params;
    const { radius = '100', limit = '20' } = req.query;

    // Haversine formula for distance in miles
    const query = `
      SELECT *,
        (3959 * acos(
          cos(radians($1)) * cos(radians(latitude)) * cos(radians(longitude) - radians($2)) +
          sin(radians($1)) * sin(radians(latitude))
        )) AS distance_miles
      FROM stations
      WHERE (3959 * acos(
        cos(radians($1)) * cos(radians(latitude)) * cos(radians(longitude) - radians($2)) +
        sin(radians($1)) * sin(radians(latitude))
      )) < $3
      ORDER BY distance_miles
      LIMIT $4
    `;

    const result = await pool.query(query, [lat, lng, radius, limit]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching nearby stations:', error);
    res.status(500).json({ error: 'Failed to fetch nearby stations' });
  }
});

// Get station count
router.get('/stats/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as total FROM stations');
    res.json({ total: parseInt(result.rows[0].total) });
  } catch (error) {
    console.error('Error fetching station count:', error);
    res.status(500).json({ error: 'Failed to fetch station count' });
  }
});

export default router;
