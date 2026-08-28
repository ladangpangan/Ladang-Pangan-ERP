// MongoDB cleanup script for split-karung test
const childIds = ['6239aaf7-7170-4624-8700-62361cbfad1b', 'a8197737-fbdf-4607-b585-2228d9ad38bd'];
const parentId = 'a5e58fa7-678b-463d-a882-2d8e8fa08aff';

// Delete child stocks
const deleteResult = db.inventory_stock.deleteMany({
  _id: { $in: childIds }
});
print('Deleted child stocks:', deleteResult.deletedCount);

// Restore parent stock to 'active'
const updateResult = db.inventory_stock.updateOne(
  { _id: parentId },
  { $set: { status: 'active', openedAt: null } }
);
print('Updated parent stock:', updateResult.modifiedCount);
