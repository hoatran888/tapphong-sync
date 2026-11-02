/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * Tap Phong — read-only preview by default; explicit execute to post.
 * IMPORTANT: Deploy in TEST status first and test in Sandbox.
 */
define(['N/record', 'N/search', 'N/error'], (record, search, error) => {
//   const SO_TYPE = record.Type.SALES_ORDER;
//   const IF_TYPE = record.Type.ITEM_FULFILLMENT;
//   const fail = (code, message) => { throw error.create({name: code, message}); };
// Use string constants during module initialization.
  // Do not access record.Type until an entry point is running.

  const SO_TYPE = 'salesorder';
  const IF_TYPE = 'itemfulfillment';

  const fail = (code, message) => {
    throw error.create({
      name: code,
      message: message
    });
  };
  const str = v => String(v == null ? '' : v).trim();

  function existingFulfillments(soId) {
    const ids = [];
    search.create({
      type: search.Type.ITEM_FULFILLMENT,
      filters: [['createdfrom', 'anyof', soId], 'AND', ['mainline', 'is', 'T']],
      columns: ['internalid', 'tranid', 'externalid']
    }).run().each(r => {
      ids.push({
        id: r.getValue('internalid'),
        tranId: r.getValue('tranid'),
        externalId: r.getValue('externalid')
      });
      return ids.length < 100;
    });
    return ids;
  }

  function post(input) {
    const req = input || {};
    const soId = Number(req.soId);
    const itemId = Number(req.itemId);
    const qty = Number(req.quantity);
    const locationId = Number(req.locationId);
    const dispatchRef = str(req.dispatchRef);
    const execute = req.execute === true;

    if (!Number.isSafeInteger(soId) || soId < 1)
      fail('BAD_SO', 'soId must be a NetSuite internal ID');

    if (!Number.isSafeInteger(itemId) || itemId < 1)
      fail('BAD_ITEM', 'itemId must be a NetSuite internal ID');

    if (!Number.isFinite(qty) || qty <= 0)
      fail('BAD_QTY', 'quantity must be positive');

    if (!Number.isSafeInteger(locationId) || locationId < 1)
      fail('BAD_LOCATION', 'locationId required');

    if (!dispatchRef || dispatchRef.length > 200)
      fail('BAD_DISPATCH_REF', 'dispatchRef required (max 200 characters)');

    const so = record.load({
      type: SO_TYPE,
      id: soId,
      isDynamic: false
    });

    const lines = so.getLineCount({sublistId:'item'});
    const matched = [];

    for (let i = 0; i < lines; i++) {
      if (Number(so.getSublistValue({
        sublistId:'item',
        fieldId:'item',
        line:i
      })) !== itemId) continue;

      matched.push({
        line:i,
        ordered:Number(so.getSublistValue({
          sublistId:'item',
          fieldId:'quantity',
          line:i
        })) || 0,

        fulfilled:Number(so.getSublistValue({
          sublistId:'item',
          fieldId:'quantityfulfilled',
          line:i
        })) || 0
      });
    }

    if (matched.length !== 1)
      fail(
        'ITEM_LINE_AMBIGUOUS',
        'Expected exactly one matching SO item line; found '+matched.length
      );

    const remaining = matched[0].ordered - matched[0].fulfilled;

    if (qty > remaining + 0.000001)
      fail('OVER_FULFILL', `Requested ${qty}, remaining ${remaining}`);

    const existing = existingFulfillments(soId);

    // Conservative policy:
    // Do not post when any fulfillment already exists.
    // Partial shipments require event-level reconciliation.

    if (existing.length) {
      return {
        success:false,
        blocked:true,
        reason:'Existing fulfillment(s) require manual reconciliation',
        existing,
        soId,
        dispatchRef
      };
    }

    const preview = {
      success:true,
      mode:execute?'execute':'preview',
      soId,
      itemId,
      quantity:qty,
      locationId,
      dispatchRef,
      remaining,
      existingFulfillments:existing
    };

    if (!execute) return preview;

    if (req.dispatchVerified !== true)
      fail(
        'DISPATCH_UNVERIFIED',
        'Set dispatchVerified=true only after independently confirming warehouse dispatch'
      );

    if (req.confirmExecute !== 'CREATE_FULFILLMENT')
      fail(
        'CONFIRM_REQUIRED',
        'confirmExecute must be CREATE_FULFILLMENT'
      );

    const fulfillment = record.transform({
      fromType:SO_TYPE,
      fromId:soId,
      toType:IF_TYPE,
      isDynamic:false
    });

    const n = fulfillment.getLineCount({sublistId:'item'});
    let selected = 0;

    for (let i=0; i<n; i++) {

      const id = Number(fulfillment.getSublistValue({
        sublistId:'item',
        fieldId:'item',
        line:i
      }));

      fulfillment.setSublistValue({
        sublistId:'item',
        fieldId:'itemreceive',
        line:i,
        value:false
      });

      if (id !== itemId) continue;

      selected++;

      fulfillment.setSublistValue({
        sublistId:'item',
        fieldId:'itemreceive',
        line:i,
        value:true
      });

      fulfillment.setSublistValue({
        sublistId:'item',
        fieldId:'quantity',
        line:i,
        value:qty
      });

      fulfillment.setSublistValue({
        sublistId:'item',
        fieldId:'location',
        line:i,
        value:locationId
      });

      // Inventory Detail is deliberately not guessed.
      // When inventory status/bin/lot is mandatory,
      // require explicit validated assignment implementation.

      try {
        const detail = fulfillment.getSublistSubrecord({
          sublistId:'item',
          fieldId:'inventorydetail',
          line:i
        });

        if (detail)
          fail(
            'INVENTORY_DETAIL_REQUIRED',
            'Item has Inventory Detail. Do not execute until status/bin assignment is implemented and verified.'
          );

      } catch(e) {
        if (e.name === 'INVENTORY_DETAIL_REQUIRED') throw e;

        // No inventory detail subrecord on this line.
      }
    }

    if (selected !== 1)
      fail(
        'TRANSFORM_LINE_AMBIGUOUS',
        'Transformed fulfillment must contain exactly one matching item line'
      );

    fulfillment.setValue({
      fieldId:'memo',
      value:'CartonCloud dispatch '+dispatchRef
    });

    // Leave shipstatus as NetSuite default.
    // Do not claim shipped without explicit mapping.

    const fulfillmentId = fulfillment.save({
      enableSourcing:true,
      ignoreMandatoryFields:false
    });

    return {
      ...preview,
      success:true,
      fulfillmentId,
      message:'Item Fulfillment created; verify ship status and inventory effect in NetSuite'
    };
  }

  return {post};
});