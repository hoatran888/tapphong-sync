
/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */

define(['N/search', 'N/record', 'N/log'], (search, record, log) => {

    // 1. GET method to retrieve item details by SKU
    function get(context) {

        log.debug({
            title: 'Test GET Execution',
            details: 'SKU = ' + context.sku
        });

        const sku = context.sku;
        log.debug({
        title: 'SKU Received',
        details: sku
    });
        if (!sku) {

            log.error('Missing SKU', 'SKU parameter is required');
            
            return JSON.stringify({
                success: false,
                message: 'SKU is required'
            });
        }

        log.debug('Searching SKU', sku);

        const itemSearch = search.create({
            type: search.Type.INVENTORY_ITEM,
            filters: [
                ['itemid', 'is', sku]
            ],
            columns: ['internalid', 'itemid', 'displayname']
        });

        const results = itemSearch.run().getRange({
            start: 0,
            end: 1
        });

        if (results.length === 0) {
            log.error('Item not found', `No item found with SKU: ${sku}`);
            return JSON.stringify({
                success: false,
                message: 'Item not found'
            });
        }

        return JSON.stringify({
            success: true,
            id: results[0].id,
            sku: results[0].getValue('itemid'),
            name: results[0].getValue('displayname')
        });
    }
    // 2. POST method to create a new item
    function post(context) {

        try {

            log.debug({
                title: 'POST started',
                details: 'SKU = ' + context.sku
            });

            // Validate duplicate SKU

            const existingItemId =  validateDuplicateSKU(context.sku);

            if (existingItemId != null) {
                
                    return JSON.stringify({
                    success: false,
                    message: 'SKU already exists',
                    id: existingItemId,
                    sku: context.sku
                });
      
            }
        // #region Set Item Fields
        item.setValue({
            fieldId: 'itemid',
            value: context.sku
        });

        item.setValue({
            fieldId: 'displayname',
            value: context.name
        }); 

        item.setValue({
            fieldId: 'taxschedule',
            value: 1
        }); 

        item.setValue({
            fieldId: 'subsidiary',
            value: 3
        });

        item.setValue({
            fieldId: 'assetaccount',
            value: 307
        });


        item.setValue({
            fieldId: 'cogsaccount',
            value: 210
        });

        item.setValue({
            fieldId: 'incomeaccount',
            value: 54
        });

        item.setValue({
            fieldId: 'unitstype',
            value: 3
        });
        
        item.setValue({
            fieldId: 'stockunit',
            value: 4
        });
        item.setValue({
            fieldId: 'purchaseunit',
            value: 5
        });
        item.setValue({
            fieldId: 'saleunit',
            value: 4
        });

        item.setValue({
            fieldId: 'displayname',
            value: context.name
        });

        // #endregion

        // Save item record
        // before saving, log the details of the item being created
        log.debug({
            title: 'Creating Inventory Item',
            details: 'SKU = ' + context.sku 
        })

        const itemId = item.save();

        // after saving, log the details of the created item
        log.audit({
            title: 'Inventory Item created',
            details:  'SKU = ' + context.sku + ', ID = ' + itemId
            });

        log.debug('Item Created', `New item created with ID: ${itemId}`);
        return JSON.stringify({
            success: true,
            id: itemId
        });

        }
        catch (error) {
            log.error({
                title: 'POST Failed',
                details: error.message
            })

            return JSON.stringify({
                success: false,
                message: error.message
            });
        }



    }

    // 3. Validate duplicate SKU
    function validateDuplicateSKU(sku) {
        const itemSearch = search.create({
            type: search.Type.INVENTORY_ITEM,
            filters: [
                ['itemid', 'is', sku]
            ],
            columns: ['internalid']
        }).run().getRange({
            start: 0,
            end: 1
        });

        return itemSearch.length > 0 ? itemSearch[0].id : null;


    }

    return {
        get: get,
        post:post
    };
});
