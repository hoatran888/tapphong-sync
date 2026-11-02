/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */

define([], () => {

    function get(context) {

        return {
            success: true,
            message: "RESTlet 1948 is working",
            method: "GET"
        };

    }

    function post(context) {

        return {
            success: true,
            message: "RESTlet 1948 POST is working",
            method: "POST",
            received: context
        };

    }

    return {
        get: get,
        post: post
    };

});